"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable @typescript-eslint/no-use-before-define */
const lodash_1 = __importDefault(require("lodash"));
const database_1 = __importDefault(require("../database"));
const topics_1 = __importDefault(require("../topics"));
const categories_1 = __importDefault(require("../categories"));
const user_1 = __importDefault(require("../user"));
const notifications_1 = __importDefault(require("../notifications"));
const plugins_1 = __importDefault(require("../plugins"));
const flags_1 = __importDefault(require("../flags"));
exports = function (Posts) {
    Posts.delete = function (pid, uid) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield deleteOrRestore('delete', pid, uid);
        });
    };
    Posts.restore = function (pid, uid) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield deleteOrRestore('restore', pid, uid);
        });
    };
    function deleteOrRestore(type, pid, uid) {
        return __awaiter(this, void 0, void 0, function* () {
            const isDeleting = type === 'delete';
            yield plugins_1.default.hooks.fire(`filter:post.${type}`, { pid: pid, uid: uid });
            yield Posts.setPostFields(pid, {
                deleted: isDeleting ? 1 : 0,
                deleterUid: isDeleting ? uid : 0,
            });
            const postData = yield Posts.getPostFields(pid, ['pid', 'tid', 'uid', 'content', 'timestamp']);
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
            const topicData = yield topics_1.default.getTopicFields(postData.tid, ['tid', 'cid', 'pinned']);
            // The next line makes an assignment for a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            postData.cid = topicData.cid;
            yield Promise.all([
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                topics_1.default.updateLastPostTimeFromLastPid(postData.tid),
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                topics_1.default.updateTeaser(postData.tid),
                isDeleting ?
                    // The next line calls a function in a module that has not been updated to TS yet
                    // eslint-disable-next-line max-len
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/restrict-template-expressions
                    database_1.default.sortedSetRemove(`cid:${topicData.cid}:pids`, pid) :
                    // The next line calls a function in a module that has not been updated to TS yet
                    // eslint-disable-next-line max-len
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/restrict-template-expressions
                    database_1.default.sortedSetAdd(`cid:${topicData.cid}:pids`, postData.timestamp, pid),
            ]);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            yield categories_1.default.updateRecentTidForCid(postData.cid);
            plugins_1.default.hooks.fire(`action:post.${type}`, { post: lodash_1.default.clone(postData), uid: uid }).catch((error) => { console.error('Error:', error); });
            if (type === 'delete') {
                yield flags_1.default.resolveFlag('post', pid, uid);
            }
            return postData;
        });
    }
    Posts.purge = function (pids, uid) {
        return __awaiter(this, void 0, void 0, function* () {
            pids = Array.isArray(pids) ? pids : [pids];
            let postData = yield Posts.getPostsData(pids);
            pids = pids.filter((pid, index) => !!postData[index]);
            postData = postData.filter(Boolean);
            if (!postData.length) {
                return;
            }
            const uniqTids = lodash_1.default.uniq(postData.map(p => p.tid));
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
            const topicData = yield topics_1.default.getTopicsFields(uniqTids, ['tid', 'cid', 'pinned', 'postcount']);
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            const tidToTopic = lodash_1.default.zipObject(uniqTids, topicData);
            postData.forEach((p) => {
                p.topic = tidToTopic[p.tid];
                p.cid = tidToTopic[p.tid].cid;
            });
            // deprecated hook
            yield Promise.all(postData.map(p => plugins_1.default.hooks.fire('filter:post.purge', { post: p, pid: p.pid, uid: uid })));
            // new hook
            yield plugins_1.default.hooks.fire('filter:posts.purge', {
                posts: postData,
                pids: postData.map(p => p.pid),
                uid: uid,
            });
            yield Promise.all([
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
                database_1.default.sortedSetsRemove(['posts:pid', 'posts:votes', 'posts:flagged'], pids),
            ]);
            yield resolveFlags(postData, uid);
            // deprecated hook
            Promise.all(postData.map(p => plugins_1.default.hooks.fire('action:post.purge', { post: p, uid: uid }))).catch((error) => { console.error('Error:', error); });
            // new hook
            plugins_1.default.hooks.fire('action:posts.purge', { posts: postData, uid: uid }).catch((error) => { console.error('Error:', error); });
            // This next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            yield database_1.default.deleteAll(postData.map(p => `post:${p.pid}`));
        });
    };
    function deleteFromTopicUserNotification(postData) {
        return __awaiter(this, void 0, void 0, function* () {
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
            yield database_1.default.sortedSetRemoveBulk(bulkRemove);
            const incrObjectBulk = [['global', { postCount: -postData.length }]];
            const postsByCategory = lodash_1.default.groupBy(postData, p => parseInt(String(p.cid), 10));
            for (const [cid, posts] of Object.entries(postsByCategory)) {
                incrObjectBulk.push([`category:${cid}`, { postCount: -posts.length }]);
            }
            const postsByTopic = lodash_1.default.groupBy(postData, p => parseInt(String(p.tid), 10));
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
                topicTasks.push(topics_1.default.updateTeaser(tid));
                // This next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                topicTasks.push(topics_1.default.updateLastPostTimeFromLastPid(tid));
                const postsByUid = lodash_1.default.groupBy(posts, p => parseInt(String(p.uid), 10));
                for (const [uid, uidPosts] of Object.entries(postsByUid)) {
                    zsetIncrBulk.push([`tid:${tid}:posters`, -uidPosts.length, uid]);
                }
                // This next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                topicTasks.push(database_1.default.sortedSetIncrByBulk(zsetIncrBulk));
            }
            yield Promise.all([
                // This next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                database_1.default.incrObjectFieldByBulk(incrObjectBulk),
                // This next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                database_1.default.sortedSetAddBulk(topicPostCountTasks),
                // This next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                ...topicTasks,
                // This next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                user_1.default.updatePostCount(lodash_1.default.uniq(postData.map(p => p.uid))),
                notifications_1.default.rescind(...postData.map(p => `new_post:tid:${p.tid}:pid:${p.pid}:uid:${p.uid}`)),
            ]);
        });
    }
    function deleteFromCategoryRecentPosts(postData) {
        return __awaiter(this, void 0, void 0, function* () {
            const uniqCids = lodash_1.default.uniq(postData.map(p => p.cid));
            const sets = uniqCids.map(cid => `cid:${cid}:pids`);
            // This next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            yield database_1.default.sortedSetRemove(sets, postData.map(p => p.pid));
            yield Promise.all(uniqCids.map((cid, index, array) => categories_1.default.updateRecentTidForCid(cid, index, array)));
        });
    }
    function deleteFromUsersBookmarks(pids) {
        return __awaiter(this, void 0, void 0, function* () {
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            const arrayOfUids = yield database_1.default.getSetsMembers(pids.map(pid => `pid:${pid}:users_bookmarked`));
            const bulkRemove = [];
            pids.forEach((pid, index) => {
                arrayOfUids[index].forEach((uid) => {
                    bulkRemove.push([`uid:${uid}:bookmarks`, pid]);
                });
            });
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            yield database_1.default.sortedSetRemoveBulk(bulkRemove);
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            yield database_1.default.deleteAll(pids.map(pid => `pid:${pid}:users_bookmarked`));
        });
    }
    function deleteFromUsersVotes(pids) {
        return __awaiter(this, void 0, void 0, function* () {
            const [upvoters, downvoters] = yield Promise.all([
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                database_1.default.getSetsMembers(pids.map(pid => `pid:${pid}:upvote`)),
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                database_1.default.getSetsMembers(pids.map(pid => `pid:${pid}:downvote`)),
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
            yield Promise.all([
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                database_1.default.sortedSetRemoveBulk(bulkRemove),
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                database_1.default.deleteAll([
                    ...pids.map(pid => `pid:${pid}:upvote`),
                    ...pids.map(pid => `pid:${pid}:downvote`),
                ]),
            ]);
        });
    }
    function deleteFromReplies(postData) {
        return __awaiter(this, void 0, void 0, function* () {
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            const arrayOfReplyPids = yield database_1.default.getSortedSetsMembers(postData.map(p => `pid:${p.pid}:replies`));
            const allReplyPids = lodash_1.default.flatten(arrayOfReplyPids);
            const promises = [
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                database_1.default.deleteObjectFields(allReplyPids.map(pid => `post:${pid}`), ['toPid']),
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                database_1.default.deleteAll(postData.map(p => `pid:${p.pid}:replies`)),
            ];
            const postsWithParents = postData.filter(p => parseInt(String(p.toPid), 10));
            const bulkRemove = postsWithParents.map(p => [`pid:${p.toPid}:replies`, p.pid]);
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            promises.push(database_1.default.sortedSetRemoveBulk(bulkRemove));
            yield Promise.all(promises);
            const parentPids = lodash_1.default.uniq(postsWithParents.map(p => p.toPid));
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            const counts = yield database_1.default.sortedSetsCard(parentPids.map(pid => `pid:${pid}:replies`));
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            yield database_1.default.setObjectBulk(parentPids.map((pid, index) => [`post:${pid}`, { replies: counts[index] }]));
        });
    }
    function deleteFromGroups(pids) {
        return __awaiter(this, void 0, void 0, function* () {
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            const groupNames = yield database_1.default.getSortedSetMembers('groups:visible:createtime');
            const keys = groupNames.map(groupName => `group:${groupName}:member:pids`);
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            yield database_1.default.sortedSetRemove(keys, pids);
        });
    }
    function deleteDiffs(pids) {
        return __awaiter(this, void 0, void 0, function* () {
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            const timestamps = yield Promise.all(pids.map(pid => Posts.diffs.list(pid)));
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            yield database_1.default.deleteAll([
                ...pids.map(pid => `post:${pid}:diffs`),
                ...lodash_1.default.flattenDeep(pids.map((pid, index) => timestamps[index].map(t => `diff:${pid}.${t}`))),
            ]);
        });
    }
    function deleteFromUploads(pids) {
        return __awaiter(this, void 0, void 0, function* () {
            yield Promise.all(pids.map(Posts.uploads.dissociateAll));
        });
    }
    function resolveFlags(postData, uid) {
        return __awaiter(this, void 0, void 0, function* () {
            const flaggedPosts = postData.filter(p => parseInt(String(p.flagId), 10));
            yield Promise.all(flaggedPosts.map(p => flags_1.default.update(p.flagId, uid, { state: 'resolved' })));
        });
    }
};
