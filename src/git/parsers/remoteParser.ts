'use strict';
import { GitRemote } from './../git';
import { GitRemoteType } from '../models/remote';

const remoteRegex = /^(.*)\t(.*)\s\((.*)\)$/gm;
const urlRegex = /^(?:git:\/\/(.*?)\/|https:\/\/(.*?)\/|http:\/\/(.*?)\/|git@(.*):|ssh:\/\/(?:.*@)?(.*?)(?::.*?)?\/)(.*)$/;

export class GitRemoteParser {

    static parse(data: string, repoPath: string): GitRemote[] {
        if (!data) return [];

        const remotes: GitRemote[] = [];
        const groups = Object.create(null);

        let match: RegExpExecArray | null = null;
        do {
            match = remoteRegex.exec(data);
            if (match == null) break;

            const url = match[2];

            const [domain, path] = this.parseGitUrl(url);

            let remote: GitRemote | undefined = groups[url];
            if (remote === undefined) {
                remote = new GitRemote(repoPath, match[1], url, domain, path, [match[3] as GitRemoteType]);
                remotes.push(remote);
                groups[url] = remote;
            }
            else {
                remote.types.push(match[3] as GitRemoteType);
            }
        } while (match != null);

        if (!remotes.length) return [];

        return remotes;
    }

    static parseGitUrl(url: string): [string, string] {
        const match = urlRegex.exec(url);
        if (match == null) return ['', ''];

        return [
            match[1] || match[2] || match[3] || match[4] || match[5],
            match[6].replace(/\.git\/?$/, '')
        ];
    }
}