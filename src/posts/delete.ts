/* eslint-disable @typescript-eslint/no-use-before-define */
import _ from 'lodash';
import db from '../database';
import topics from '../topics';
import categories from '../categories';
import user from '../user';
import notifications from '../notifications';
import plugins from '../plugins';
import flags from '../flags';
import { TopicObject } from '../types/topic';

interface ListFunction {
  (pid: number): Promise<number[]>;
}
interface Diffs {
  list: ListFunction;
}
interface PostType {
  diffs: Diffs;
  delete: (pid: number, uid: number) => Promise<PostData>;
  restore: (pid: number, uid: number) => Promise<PostData>;
  purge: (pids: number | number[], uid: number) => Promise<void>;
  getPostFields: (pid: number, fields: string[]) => Promise<PostData>;
  setPostFields: (pid: number, data: { deleted: number; deleterUid: number }) => Promise<void>;
  getPostsData: (pids: number[]) => Promise<PostData[]>;
}

interface PostData {
  pid: number;
  tid: number;
  uid: number;
  content: string;
  timestamp: number;
  toPid: number | null;
  cid?: number;
  flagId?: number;
  topic?: TopicObject;
}

exports = function (Posts: PostType) {
    Posts.delete = async function (pid: number, uid: number): Promise<PostData> {
        return await deleteOrRestore('delete', pid, uid);
    };

    Posts.restore = async function (pid: number, uid: number): Promise<PostData> {
        return await deleteOrRestore('restore', pid, uid);
    };

    async function deleteOrRestore(type: 'delete' | 'restore', pid: number, uid: number): Promise<PostData> {
        const isDeleting = type === 'delete';
        await plugins.hooks.fire(`filter:post.${type}`, { pid: pid, uid: uid });
        await Posts.setPostFields(pid, {
            deleted: isDeleting ? 1 : 0,
            deleterUid: isDeleting ? uid : 0,
        });
        const postData = await Posts.getPostFields(pid, ['pid', 'tid', 'uid', 'content', 'timestamp']);
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const topicData = await topics.getTopicFields(postData.tid, ['tid', 'cid', 'pinned']);
        // The next line makes an assignment for a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        postData.cid = topicData.cid;
        await Promise.all([
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            topics.updateLastPostTimeFromLastPid(postData.tid),
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            topics.updateTeaser(postData.tid),
            isDeleting ?
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line max-len
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/restrict-template-expressions
                db.sortedSetRemove(`cid:${topicData.cid}:pids`, pid) :
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line max-len
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/restrict-template-expressions
                db.sortedSetAdd(`cid:${topicData.cid}:pids`, postData.timestamp, pid),
        ]);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        await categories.updateRecentTidForCid(postData.cid);
        plugins.hooks.fire(`action:post.${type}`, { post: _.clone(postData), uid: uid }).catch((error) => { console.error('Error:', error); });
        if (type === 'delete') {
            await flags.resolveFlag('post', pid, uid);
        }
        return postData;
    }

    Posts.purge = async function (pids: number | number[], uid: number) {
        pids = Array.isArray(pids) ? pids : [pids];
        let postData = await Posts.getPostsData(pids);
        pids = pids.filter((pid, index) => !!postData[index]);
        postData = postData.filter(Boolean);
        if (!postData.length) {
            return;
        }
        const uniqTids = _.uniq(postData.map(p => p.tid));
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const topicData = await topics.getTopicsFields(uniqTids, ['tid', 'cid', 'pinned', 'postcount']);
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const tidToTopic = _.zipObject(uniqTids, topicData);

        postData.forEach((p) => {
            p.topic = tidToTopic[p.tid] as TopicObject;
            p.cid = (tidToTopic[p.tid] as TopicObject).cid;
        });

        // deprecated hook
        await Promise.all(postData.map(p => plugins.hooks.fire('filter:post.purge', { post: p, pid: p.pid, uid: uid })));

        // new hook
        await plugins.hooks.fire('filter:posts.purge', {
            posts: postData,
            pids: postData.map(p => p.pid),
            uid: uid,
        });

        await Promise.all([
            deleteFromTopicUserNotification(postData),
            deleteFromCategoryRecentPosts(postData),
            deleteFromUsersBookmarks(pids),
            deleteFromUsersVotes(pids),
            deleteFromReplies(postData),
            deleteFromGroups(pids),
            deleteDiffs(pids),
            deleteFromUploads(pids),
            // This next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.sortedSetsRemove(['posts:pid', 'posts:votes', 'posts:flagged'], pids),
        ]);

        await resolveFlags(postData, uid);

        // deprecated hook
        Promise.all(postData.map(p => plugins.hooks.fire('action:post.purge', { post: p, uid: uid }))).catch((error) => { console.error('Error:', error); });

        // new hook
        plugins.hooks.fire('action:posts.purge', { posts: postData, uid: uid }).catch((error) => { console.error('Error:', error); });
        // This next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.deleteAll(postData.map(p => `post:${p.pid}`));
    };

    async function deleteFromTopicUserNotification(postData: PostData[]) {
        const bulkRemove = [];
        postData.forEach((p) => {
            bulkRemove.push([`tid:${p.tid}:posts`, p.pid]);
            bulkRemove.push([`tid:${p.tid}:posts:votes`, p.pid]);
            bulkRemove.push([`uid:${p.uid}:posts`, p.pid]);
            bulkRemove.push([`cid:${p.cid}:uid:${p.uid}:pids`, p.pid]);
            bulkRemove.push([`cid:${p.cid}:uid:${p.uid}:pids:votes`, p.pid]);
        });
        // This next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.sortedSetRemoveBulk(bulkRemove);

        const incrObjectBulk = [['global', { postCount: -postData.length }]];

        const postsByCategory = _.groupBy(postData, p => parseInt(String(p.cid), 10));
        for (const [cid, posts] of Object.entries(postsByCategory)) {
            incrObjectBulk.push([`category:${cid}`, { postCount: -posts.length }]);
        }

        const postsByTopic = _.groupBy(postData, p => parseInt(String(p.tid), 10));
        const topicPostCountTasks = [];
        const topicTasks = [];
        const zsetIncrBulk = [];
        for (const [tid, posts] of Object.entries(postsByTopic)) {
            incrObjectBulk.push([`topic:${tid}`, { postCount: -posts.length }]);
            if (posts.length && posts[0]) {
                const topicData = posts[0].topic;
                const newPostCount = Number(topicData.postcount) - posts.length;
                topicPostCountTasks.push(['topics:posts', newPostCount, tid]);
                if (!topicData.pinned) {
                    zsetIncrBulk.push([`cid:${topicData.cid}:tids:posts`, -posts.length, tid]);
                }
            }
            // This next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            topicTasks.push(topics.updateTeaser(tid));
            // This next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            topicTasks.push(topics.updateLastPostTimeFromLastPid(tid));
            const postsByUid = _.groupBy(posts, p => parseInt(String(p.uid), 10));
            for (const [uid, uidPosts] of Object.entries(postsByUid)) {
                zsetIncrBulk.push([`tid:${tid}:posters`, -uidPosts.length, uid]);
            }
            // This next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            topicTasks.push(db.sortedSetIncrByBulk(zsetIncrBulk));
        }

        await Promise.all([
            // This next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.incrObjectFieldByBulk(incrObjectBulk),
            // This next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.sortedSetAddBulk(topicPostCountTasks),
            // This next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            ...topicTasks,
            // This next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            user.updatePostCount(_.uniq(postData.map(p => p.uid))),
            notifications.rescind(...postData.map(p => `new_post:tid:${p.tid}:pid:${p.pid}:uid:${p.uid}`)),
        ]);
    }

    async function deleteFromCategoryRecentPosts(postData: PostData[]) {
        const uniqCids = _.uniq(postData.map(p => p.cid));
        const sets = uniqCids.map(cid => `cid:${cid}:pids`);
        // This next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.sortedSetRemove(sets, postData.map(p => p.pid));
        await Promise.all(uniqCids.map((cid, index, array) => (
            categories.updateRecentTidForCid as (
                value: number, index: number, array: number[]) =>unknown)(cid, index, array)));
    }

    async function deleteFromUsersBookmarks(pids: number[]) {
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const arrayOfUids = await db.getSetsMembers(pids.map(pid => `pid:${pid}:users_bookmarked`)) as number[][];
        const bulkRemove = [];
        pids.forEach((pid: number, index: number) => {
            arrayOfUids[index].forEach((uid: number) => {
                bulkRemove.push([`uid:${uid}:bookmarks`, pid]);
            });
        });
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.sortedSetRemoveBulk(bulkRemove);
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.deleteAll(pids.map(pid => `pid:${pid}:users_bookmarked`));
    }

    async function deleteFromUsersVotes(pids: number[]) {
        const [upvoters, downvoters] = await Promise.all([
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.getSetsMembers(pids.map(pid => `pid:${pid}:upvote`)) as number[][],
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.getSetsMembers(pids.map(pid => `pid:${pid}:downvote`)) as number[][],
        ]);
        const bulkRemove = [];
        pids.forEach((pid, index) => {
            upvoters[index].forEach((upvoterUid) => {
                bulkRemove.push([`uid:${upvoterUid}:upvote`, pid]);
            });
            downvoters[index].forEach((downvoterUid) => {
                bulkRemove.push([`uid:${downvoterUid}:downvote`, pid]);
            });
        });

        await Promise.all([
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.sortedSetRemoveBulk(bulkRemove),
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.deleteAll([
                ...pids.map(pid => `pid:${pid}:upvote`),
                ...pids.map(pid => `pid:${pid}:downvote`),
            ]),
        ]);
    }

    async function deleteFromReplies(postData: PostData[]) {
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const arrayOfReplyPids = await db.getSortedSetsMembers(postData.map(p => `pid:${p.pid}:replies`)) as number[][];
        const allReplyPids = _.flatten(arrayOfReplyPids);
        const promises = [
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.deleteObjectFields(
                allReplyPids.map(pid => `post:${pid}`), ['toPid']
            ),
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.deleteAll(postData.map(p => `pid:${p.pid}:replies`)),
        ];

        const postsWithParents = postData.filter(p => parseInt(String(p.toPid), 10));
        const bulkRemove: [string, number][] = postsWithParents.map(p => [`pid:${p.toPid}:replies`, p.pid]);
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        promises.push(db.sortedSetRemoveBulk(bulkRemove));
        await Promise.all(promises);

        const parentPids = _.uniq(postsWithParents.map(p => p.toPid));
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const counts = await db.sortedSetsCard(parentPids.map(pid => `pid:${pid}:replies`)) as number[];
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.setObjectBulk(parentPids.map((pid, index) => [`post:${pid}`, { replies: counts[index] }]));
    }

    async function deleteFromGroups(pids: number[]) {
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const groupNames = await db.getSortedSetMembers('groups:visible:createtime') as string[];
        const keys = groupNames.map(groupName => `group:${groupName}:member:pids`);
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.sortedSetRemove(keys, pids);
    }

    async function deleteDiffs(pids: number[]): Promise<void> {
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        const timestamps: number[][] = await Promise.all(pids.map(pid => Posts.diffs.list(pid)));
        // The next line calls a function in a module that has not been updated to TS yet
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        await db.deleteAll([
            ...pids.map(pid => `post:${pid}:diffs`),
            ..._.flattenDeep(pids.map((pid, index) => timestamps[index].map(t => `diff:${pid}.${t}`))),
        ]);
    }

    async function deleteFromUploads(pids) {
        await Promise.all(pids.map(Posts.uploads.dissociateAll));
    }

    async function resolveFlags(postData, uid) {
        const flaggedPosts = postData.filter(p => parseInt(p.flagId, 10));
        await Promise.all(flaggedPosts.map(p => flags.update(p.flagId, uid, { state: 'resolved' })));
    }
};
