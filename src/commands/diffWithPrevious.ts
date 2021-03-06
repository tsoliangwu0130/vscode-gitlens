'use strict';
import { commands, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { Iterables } from '../system';
import { ActiveEditorCommand, command, CommandContext, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';
import { DiffWithWorkingCommandArgs } from './diffWithWorking';

export interface DiffWithPreviousCommandArgs {
    commit?: GitCommit;

    inDiffEditor?: boolean;
    line?: number;
    showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithPreviousCommand extends ActiveEditorCommand {
    constructor() {
        super([Commands.DiffWithPrevious, Commands.DiffWithPreviousInDiff]);
    }

    protected async preExecute(context: CommandContext, args: DiffWithPreviousCommandArgs = {}): Promise<any> {
        if (context.command === Commands.DiffWithPreviousInDiff) {
            args.inDiffEditor = true;
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithPreviousCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;

        args = { ...args };
        if (args.line === undefined) {
            args.line = editor == null ? 0 : editor.selection.active.line;
        }

        if (args.commit === undefined || !args.commit.isFile) {
            const gitUri = await GitUri.fromUri(uri);

            try {
                let sha = args.commit === undefined ? gitUri.sha : args.commit.sha;
                if (sha === GitService.deletedOrMissingSha) {
                    return Messages.showCommitHasNoPreviousCommitWarningMessage();
                }

                // If we are a fake "staged" sha, remove it
                let isStagedUncommitted = false;
                if (GitService.isStagedUncommitted(sha!)) {
                    gitUri.sha = sha = undefined;
                    isStagedUncommitted = true;
                }

                // If we are in a diff editor, assume we are on the right side, and need to move back 2 revisions
                const originalSha = sha;
                if (args.inDiffEditor && sha !== undefined) {
                    sha = `${sha}^`;
                }

                args.commit = undefined;

                let log = await Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, {
                    maxCount: 2,
                    ref: sha,
                    renames: true
                });

                if (log !== undefined) {
                    args.commit = (sha && log.commits.get(sha)) || Iterables.first(log.commits.values());
                }
                else {
                    // Only kick out if we aren't looking for the previous sha -- since renames won't return a log above
                    if (sha === undefined || !sha.endsWith('^')) {
                        return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');
                    }

                    // Check for renames
                    log = await Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, {
                        maxCount: 3,
                        ref: originalSha,
                        renames: true
                    });

                    if (log === undefined) {
                        return Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');
                    }

                    args.commit =
                        Iterables.next(Iterables.skip(log.commits.values(), 1)) ||
                        Iterables.first(log.commits.values());

                    if (args.commit.sha === originalSha) {
                        return Messages.showCommitHasNoPreviousCommitWarningMessage();
                    }
                }

                // If the sha is missing (i.e. working tree), check the file status
                // If file is uncommitted, then treat it as a DiffWithWorking
                if (gitUri.sha === undefined) {
                    const status = await Container.git.getStatusForFile(gitUri.repoPath!, gitUri.fsPath);
                    if (status !== undefined) {
                        if (isStagedUncommitted) {
                            const diffArgs: DiffWithCommandArgs = {
                                repoPath: args.commit.repoPath,
                                lhs: {
                                    sha: args.inDiffEditor
                                        ? args.commit.previousSha || GitService.deletedOrMissingSha
                                        : args.commit.sha,
                                    uri: args.inDiffEditor ? args.commit.previousUri : args.commit.uri
                                },
                                rhs: {
                                    sha: args.inDiffEditor ? args.commit.sha : GitService.stagedUncommittedSha,
                                    uri: args.commit.uri
                                },
                                line: args.line,
                                showOptions: args.showOptions
                            };
                            return commands.executeCommand(Commands.DiffWith, diffArgs);
                        }

                        // Check if the file is staged
                        if (status.indexStatus !== undefined) {
                            const diffArgs: DiffWithCommandArgs = {
                                repoPath: args.commit.repoPath,
                                lhs: {
                                    sha: args.inDiffEditor ? args.commit.sha : GitService.stagedUncommittedSha,
                                    uri: args.commit.uri
                                },
                                rhs: {
                                    sha: args.inDiffEditor ? GitService.stagedUncommittedSha : '',
                                    uri: args.commit.uri
                                },
                                line: args.line,
                                showOptions: args.showOptions
                            };

                            return commands.executeCommand(Commands.DiffWith, diffArgs);
                        }

                        if (!args.inDiffEditor) {
                            return commands.executeCommand(Commands.DiffWithWorking, uri, {
                                commit: args.commit,
                                showOptions: args.showOptions
                            } as DiffWithWorkingCommandArgs);
                        }
                    }
                }
            }
            catch (ex) {
                Logger.error(ex, 'DiffWithPreviousCommand', `getLogForFile(${gitUri.repoPath}, ${gitUri.fsPath})`);
                return Messages.showGenericErrorMessage('Unable to open compare');
            }
        }

        const diffArgs: DiffWithCommandArgs = {
            repoPath: args.commit.repoPath,
            lhs: {
                sha: args.commit.previousSha !== undefined ? args.commit.previousSha : GitService.deletedOrMissingSha,
                uri: args.commit.previousUri
            },
            rhs: {
                sha: args.commit.sha,
                uri: args.commit.uri
            },
            line: args.line,
            showOptions: args.showOptions
        };
        return commands.executeCommand(Commands.DiffWith, diffArgs);
    }
}
