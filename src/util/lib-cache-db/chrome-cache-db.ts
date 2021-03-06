/* 
 * Copyright (C) 2018 Qli5. All Rights Reserved.
 * 
 * @author qli5 <goodlq11[at](163|gmail).com>
 * 
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { MutationInit, NamedMutationInit, NamedArrayBuffer } from './base-mutable-cache-db.js';
import BaseMutableCacheDB from './base-mutable-cache-db.js';
import WritableStream from '../lib-util-streams/writablestream-types.js';
import { navigator, FileLike } from './common-cache-db.js';

declare const requestFileSystem: typeof window.requestFileSystem
declare const webkitRequestFileSystem: typeof window.webkitRequestFileSystem

/**
 * A streamified + promisified cache database backed by webkit filesystem
 */
class ChromeCacheDB extends BaseMutableCacheDB {
    mutableBlob: boolean
    db: Promise<DirectoryEntry> | DirectoryEntry | null
    store: Promise<DirectoryEntry> | DirectoryEntry | null

    /**
     * === NOTICE: Blobs may mutate! ===
     * 
     * In both Chrome and Firefox, instances of File are actually real-time
     * references to the hard disk. The problem is that File extends Blob - 
     * which means they by spec should not mutate. While in most cases the user
     * will not edit the file s/he is going to upload, there still exist some 
     * edge cases. Unfortunately, this library is very likely to trigger one.
     * 
     * To fix this "mutable Blob" problem, by default all get-* functions will
     * return a snapshot instead of the real-time references. This may leads to
     * more RAM consumption and/or more delay. If you are aware of this problem
     * and decide to handle it yourself, please set mutableBlob to true.
     * 
     * @param dbName database name
     * @param storeName store name
     * @param mutableBlob allow mutable Blob
     */
    constructor(dbName: string, storeName: string, { mutableBlob = false } = {}) {
        super(dbName, storeName);
        this.mutableBlob = mutableBlob;
        this.db = null;
        this.store = null;
    }

    async getDB() {
        if (this.db) return this.db;
        else return this.db = (async () => {
            const { root } = await new Promise<FileSystem>((typeof requestFileSystem === 'function' ? requestFileSystem : webkitRequestFileSystem).bind(window, 0, 0));
            return this.db = await new Promise<DirectoryEntry>(root.getDirectory.bind(root, this.dbName, { create: true }));
        })();
    }

    async getStore() {
        if (this.store) return this.store;
        else return this.store = (async () => {
            const db = await this.getDB();
            return this.store = await new Promise<DirectoryEntry>(db.getDirectory.bind(db, this.storeName, { create: true }));
        })();
    }

    async createData(item: FileLike | NamedArrayBuffer): Promise<ProgressEvent>
    async createData(item: Blob | ArrayBuffer, name: string): Promise<ProgressEvent>
    async createData(item: Blob | ArrayBuffer, options: NamedMutationInit): Promise<ProgressEvent>
    async createData(item: (Blob | ArrayBuffer) & { name?: string }, name: string | NamedMutationInit | undefined = item.name) {
        name = typeof name === 'object' ? name.name : name;
        if (!name) throw new TypeError(`CommonCacheDB.prototype.createData: cannot find name in parameters`);
        if (!(item instanceof Blob)) item = new Blob([item]);
        const store = await this.getStore();
        const file = await new Promise<FileEntry>(store.getFile.bind(store, name, { create: true, exclusive: true }));
        const writer = await new Promise<FileWriter>(file.createWriter.bind(file));
        return new Promise<ProgressEvent>((resolve, reject) => {
            writer.onwriteend = resolve;
            writer.onerror = reject;
            writer.write(item as Blob);
        });
    }

    async setData(item: FileLike | NamedArrayBuffer, options?: MutationInit): Promise<ProgressEvent>
    async setData(item: Blob | ArrayBuffer, name: string, options?: MutationInit): Promise<ProgressEvent>
    async setData(item: Blob | ArrayBuffer, options: NamedMutationInit): Promise<ProgressEvent>
    async setData(item: (Blob | ArrayBuffer) & { name?: string }, name: string | MutationInit | undefined = item.name, options: MutationInit = typeof name == 'object' ? name : {}) {
        name = typeof name === 'object' ? name.name : name;
        if (!name) throw new TypeError(`CommonCacheDB.prototype.setData: cannot find name in parameters`);
        if (!(item instanceof Blob)) item = new Blob([item]);
        const { offset, append, truncate } = options;
        const writer = await this.createWriter({ name, offset, append });
        return new Promise<ProgressEvent>((resolve, reject) => {
            writer.onwriteend = truncate ? () => {
                writer.truncate(writer.position);
                writer.onwriteend = resolve;
            } : resolve;
            writer.onerror = reject;
            writer.write(item as Blob);
        });
    }

    async appendData(item: FileLike | NamedArrayBuffer, options?: MutationInit): Promise<ProgressEvent>
    async appendData(item: Blob | ArrayBuffer, name: string, options?: MutationInit): Promise<ProgressEvent>
    async appendData(item: Blob | ArrayBuffer, options: NamedMutationInit): Promise<ProgressEvent>
    async appendData(item: (Blob | ArrayBuffer) & { name?: string }, name: string | MutationInit | undefined = item.name, options: MutationInit = typeof name == 'object' ? name : {}) {
        name = typeof name === 'object' ? name.name : name;
        if (!name) throw new TypeError(`CommonCacheDB.prototype.appendData: cannot find name in parameters`);
        return this.setData(item, name, { ...options, append: true });
    }

    async getData(name: string) {
        const store = await this.getStore();
        try {
            const file = await new Promise<FileEntry>(store.getFile.bind(store, name, { create: false }));
            const item = await new Promise<File>(file.file.bind(file));
            if (this.mutableBlob) return item;
            return ChromeCacheDB.cloneBlob(item);
        }
        catch (e) {
            if (e.name !== 'NotFoundError') throw e;
            return null;
        }
    }

    async hasData(name: string) {
        const store = await this.getStore();
        try {
            const file = await new Promise<FileEntry>(store.getFile.bind(store, name, { create: false }));
            return true;
        }
        catch (e) {
            if (e.name !== 'NotFoundError') throw e;
            return false;
        }
    }

    async deleteData(name: string) {
        const store = await this.getStore();
        try {
            const file = await new Promise<FileEntry>(store.getFile.bind(store, name, { create: false }));
            return new Promise<void>(file.remove.bind(file));
        }
        catch (e) {
            if (e.name !== 'NotFoundError') throw e;
            return null;
        }
    }

    async deleteAllData() {
        const store = await this.getStore();
        return new Promise<void>(store.removeRecursively.bind(store));
    }

    async deleteEntireDB() {
        const db = await this.getStore();
        return new Promise<void>(db.removeRecursively.bind(db));
    }

    async renameData(name: string, newName: string) {
        const store = await this.getStore();
        const file = await new Promise<FileEntry>(store.getFile.bind(store, name, { create: false }));
        return new Promise<FileEntry>(file.moveTo.bind(file, store, newName));
    }

    async createWriter({ name, offset = 0, append = false }: NamedMutationInit) {
        const store = await this.getStore();
        const file = await new Promise<FileEntry>(store.getFile.bind(store, name, { create: true, exclusive: false }));
        const writer = await new Promise<FileWriter>(file.createWriter.bind(file));
        if (offset) writer.seek(offset);
        if (append) writer.seek(writer.length);
        return writer;
    }

    async createWriteSink({ name, offset = 0, append = false, truncate = false }: NamedMutationInit) {
        const writer = await this.createWriter({ name, offset, append });
        return {
            write(data: Blob | ArrayBuffer) {
                return new Promise<ProgressEvent>((resolve, reject) => {
                    if (!(data instanceof Blob)) data = new Blob([data]);
                    writer.onwriteend = resolve;
                    writer.onerror = reject;
                    writer.write(data);
                });
            },
            close: truncate ? undefined : function close() {
                return new Promise<ProgressEvent>((resolve, reject) => {
                    writer.onwriteend = resolve;
                    writer.onerror = reject;
                    writer.truncate(writer.position);
                });
            }
        };
    }

    async createWriteStream(options: NamedMutationInit): Promise<WritableStream>
    async createWriteStream(name: string, options?: MutationInit): Promise<WritableStream>
    async createWriteStream(name: string | NamedMutationInit, options: MutationInit = typeof name == 'object' ? name : {}) {
        name = typeof name === 'object' ? name.name : name;
        return new WritableStream(await this.createWriteSink({ ...options, name }));
    }

    async getFileURL(name: string) {
        const store = await this.getStore();
        try {
            const file = await new Promise<FileEntry>(store.getFile.bind(store, name, { create: false }));
            return file.toURL();
        }
        catch (e) {
            if (e.name !== 'NotFoundError') throw e;
            return null;
        }
    }

    static get isSupported() {
        return typeof webkitRequestFileSystem === 'function';
    }

    static async quota() {
        if (navigator.storage) {
            return navigator.storage.estimate();
        }
        else if (navigator.webkitTemporaryStorage) {
            return new Promise<{ usage: number, quota: number }>(resolve => {
                navigator.webkitTemporaryStorage!.queryUsageAndQuota((usage: number, quota: number) => resolve({ usage, quota }));
            })
        }
        else {
            return { usage: -1, quota: -1 };
        }
    }
}

export default ChromeCacheDB;
