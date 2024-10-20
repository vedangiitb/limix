/* eslint-disable @typescript-eslint/tslint/config */
// *****************************************************************************
// Copyright (C) 2017 TypeFox and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry, MessageService, isWindows, MaybeArray, SelectionService, Emitter, OS }
    from '@theia/core/lib/common';
import { isOSX, environment } from '@theia/core';
import {
    open, OpenerService, CommonMenus, KeybindingRegistry, KeybindingContribution,
    FrontendApplicationContribution, SHELL_TABBAR_CONTEXT_COPY, OnWillStopAction, Navigatable, SaveableSource, Widget,
    LabelProvider
} from '@theia/core/lib/browser';
import { FileDialogService, OpenFileDialogProps, FileDialogTreeFilters } from '@theia/filesystem/lib/browser';
import { ContextKeyService } from '@theia/core/lib/browser/context-key-service';
import { WorkspaceService } from './workspace-service';
import { WorkspaceFileService, THEIA_EXT, VSCODE_EXT } from '../common';
import { WorkspaceCommands } from './workspace-commands';
import { QuickOpenWorkspace } from './quick-open-workspace';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { EncodingRegistry } from '@theia/core/lib/browser/encoding-registry';
import { UTF8 } from '@theia/core/lib/common/encodings';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { PreferenceConfigurations } from '@theia/core/lib/browser/preferences/preference-configurations';
import { nls } from '@theia/core/lib/common/nls';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { UntitledWorkspaceExitDialog } from './untitled-workspace-exit-dialog';
import { FilesystemSaveableService } from '@theia/filesystem/lib/browser/filesystem-saveable-service';
import { StopReason } from '@theia/core/lib/common/frontend-application-state';
import { FileSystemUtils } from '@theia/filesystem/lib/common';
import { WorkspaceInputDialog } from './workspace-input-dialog';

const validFilename: (arg: string) => boolean = require('valid-filename');

export enum WorkspaceStates {
    /**
     * The state is `empty` when no workspace is opened.
     */
    empty = 'empty',
    /**
     * The state is `workspace` when a workspace is opened.
     */
    workspace = 'workspace',
    /**
     * The state is `folder` when a folder is opened. (1 folder)
     */
    folder = 'folder',
};
export type WorkspaceState = keyof typeof WorkspaceStates;
export type WorkbenchState = keyof typeof WorkspaceStates;

/** Create the workspace section after open {@link CommonMenus.FILE_OPEN}. */
export const FILE_WORKSPACE = [...CommonMenus.FILE, '2_workspace'];

export interface DidCreateNewResourceEvent {
    uri: URI
    parent: URI
}

@injectable()
export class WorkspaceFrontendContribution implements CommandContribution, KeybindingContribution, MenuContribution, FrontendApplicationContribution {

    @inject(MessageService) protected readonly messageService: MessageService;
    @inject(FileService) protected readonly fileService: FileService;
    @inject(OpenerService) protected readonly openerService: OpenerService;
    @inject(WorkspaceService) protected readonly workspaceService: WorkspaceService;
    @inject(QuickOpenWorkspace) protected readonly quickOpenWorkspace: QuickOpenWorkspace;
    @inject(FileDialogService) protected readonly fileDialogService: FileDialogService;
    @inject(ContextKeyService) protected readonly contextKeyService: ContextKeyService;
    @inject(EncodingRegistry) protected readonly encodingRegistry: EncodingRegistry;
    @inject(PreferenceConfigurations) protected readonly preferenceConfigurations: PreferenceConfigurations;
    @inject(FilesystemSaveableService) protected readonly saveService: FilesystemSaveableService;
    @inject(WorkspaceFileService) protected readonly workspaceFileService: WorkspaceFileService;
    @inject(SelectionService) protected readonly selectionService: SelectionService;
    @inject(LabelProvider) protected readonly labelProvider: LabelProvider;

    private readonly onDidCreateNewFileEmitter = new Emitter<DidCreateNewResourceEvent>();

    configure(): void {
        const workspaceExtensions = this.workspaceFileService.getWorkspaceFileExtensions();
        for (const extension of workspaceExtensions) {
            this.encodingRegistry.registerOverride({ encoding: UTF8, extension });
        }

        this.updateEncodingOverrides();

        const workspaceFolderCountKey = this.contextKeyService.createKey<number>('workspaceFolderCount', 0);
        const updateWorkspaceFolderCountKey = () => workspaceFolderCountKey.set(this.workspaceService.tryGetRoots().length);
        updateWorkspaceFolderCountKey();

        const workspaceStateKey = this.contextKeyService.createKey<WorkspaceState>('workspaceState', 'empty');
        const updateWorkspaceStateKey = () => workspaceStateKey.set(this.updateWorkspaceStateKey());
        updateWorkspaceStateKey();

        const workbenchStateKey = this.contextKeyService.createKey<WorkbenchState>('workbenchState', 'empty');
        const updateWorkbenchStateKey = () => workbenchStateKey.set(this.updateWorkbenchStateKey());
        updateWorkbenchStateKey();

        this.updateStyles();
        this.workspaceService.onWorkspaceChanged(() => {
            this.updateEncodingOverrides();
            updateWorkspaceFolderCountKey();
            updateWorkspaceStateKey();
            updateWorkbenchStateKey();
            this.updateStyles();
        });
    }

    protected readonly toDisposeOnUpdateEncodingOverrides = new DisposableCollection();
    protected updateEncodingOverrides(): void {
        this.toDisposeOnUpdateEncodingOverrides.dispose();
        for (const root of this.workspaceService.tryGetRoots()) {
            for (const configPath of this.preferenceConfigurations.getPaths()) {
                const parent = root.resource.resolve(configPath);
                this.toDisposeOnUpdateEncodingOverrides.push(this.encodingRegistry.registerOverride({ encoding: UTF8, parent }));
            }
        }
    }

    protected updateStyles(): void {
        document.body.classList.remove('theia-no-open-workspace');
        // Display the 'no workspace opened' theme color when no folders are opened (single-root).
        if (!this.workspaceService.isMultiRootWorkspaceOpened &&
            !this.workspaceService.tryGetRoots().length) {
            document.body.classList.add('theia-no-open-workspace');
        }
    }

    protected async validateFileRename(oldName: string, newName: string, parent: FileStat): Promise<string> {
        if (OS.backend.isWindows && parent.resource.resolve(newName).isEqual(parent.resource.resolve(oldName), false)) {
            return '';
        }
        return this.validateFileName(newName, parent, false);
    }

    /**
 * Returns an error message if the file name is invalid. Otherwise, an empty string.
 *
 * @param name the simple file name of the file to validate.
 * @param parent the parent directory's file stat.
 * @param allowNested allow file or folder creation using recursive path
 */
    protected async validateFileName(name: string, parent: FileStat, allowNested: boolean = false): Promise<string> {
        if (!name) {
            return '';
        }
        // do not allow recursive rename
        if (!allowNested && !validFilename(name)) {
            return nls.localizeByDefault('The name **{0}** is not valid as a file or folder name. Please choose a different name.');
        }
        if (name.startsWith('/')) {
            return nls.localizeByDefault('A file or folder name cannot start with a slash.');
        } else if (name.startsWith(' ') || name.endsWith(' ')) {
            return nls.localizeByDefault('Leading or trailing whitespace detected in file or folder name.');
        }
        // check and validate each sub-paths
        if (name.split(/[\\/]/).some(file => !file || !validFilename(file) || /^\s+$/.test(file))) {
            return nls.localizeByDefault('\'{0}\' is not a valid file name', this.trimFileName(name));
        }
        const childUri = parent.resource.resolve(name);
        const exists = await this.fileService.exists(childUri);
        if (exists) {
            return nls.localizeByDefault('A file or folder **{0}** already exists at this location. Please choose a different name.', this.trimFileName(name));
        }
        return '';
    }

    protected trimFileName(name: string): string {
        if (name && name.length > 30) {
            return `${name.substring(0, 30)}...`;
        }
        return name;
    }

    protected fireCreateNewFile(uri: DidCreateNewResourceEvent): void {
        this.onDidCreateNewFileEmitter.fire(uri);
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(WorkspaceCommands.NEW_FOLDER, {
            isEnabled: () => true,
            isVisible: () => true,
            execute: uri => this.getDirectory(uri).then(parent => {
                if (parent) {
                    const parentUri = parent.resource;
                    const targetUri = parentUri.resolve('Untitled');
                    const vacantChildUri = FileSystemUtils.generateUniqueResourceURI(parent, targetUri, true);
                    const dialog = new WorkspaceInputDialog({
                        title: nls.localizeByDefault('New Folder...'),
                        maxWidth: 400,
                        parentUri: parentUri,
                        initialValue: vacantChildUri.path.base,
                        placeholder: nls.localize('theia/workspace/newFolderPlaceholder', 'Folder Name'),
                        validate: name => this.validateFileName(name, parent, true)
                    }, this.labelProvider);
                    dialog.open().then(async name => {
                        if (name) {
                            const folderUri = parentUri.resolve(name);
                            await this.fileService.createFolder(folderUri);
                            this.fireCreateNewFile({ parent: parentUri, uri: folderUri });
                        }
                    });
                }
            })
        });

        commands.registerCommand(WorkspaceCommands.NEW_CONTRACT_FOLDER, {
            isEnabled: () => true,
            isVisible: () => true,
            execute: async (targetDirectory, folderName, uri) => {
                try {
                    // Ensure correct URI format for the parent directory
                    const parentUri = targetDirectory ? new URI(`file:///${encodeURIComponent(targetDirectory.replace(/\\/g, '/'))}`) : uri;

                    const parent = await this.getDirectory(parentUri);

                    if (parent) {
                        const folderUri = parent.resource.resolve(folderName || 'Untitled');

                        console.log('folderUri ->', folderUri.toString());

                        await this.fileService.createFolder(folderUri);
                        this.fireCreateNewFile({ parent: parentUri, uri: folderUri });

                        console.log('Folder successfully created at:', folderUri.toString());
                    } else {
                        console.warn('Parent directory could not be found or is invalid.');
                    }
                } catch (error) {
                    console.error('Error creating folder:', error);
                }
            }
        });

        commands.registerCommand(WorkspaceCommands.NEW_CONTRACT_FILE, {
            isEnabled: () => true,
            isVisible: () => true,
            execute: async (targetDirectory, fileName, content, uri) => {
                try {
                    // Ensure correct URI format for the target directory
                    const parentUri = targetDirectory ? new URI(`file:///${encodeURIComponent(targetDirectory.replace(/\\/g, '/'))}`) : uri;

                    // Debug output to ensure URIs are correct
                    console.log('targetDirectory ->', targetDirectory);
                    console.log('parentUri ->', parentUri.toString());
                    console.log('fileName ->', fileName);

                    const parent = await this.getDirectory(parentUri);

                    if (parent) {
                        const fileUri = parent.resource.resolve(fileName); // Resolve the file URI based on the provided fileName

                        // More debug output to ensure fileUri is correctly set
                        console.log('fileUri ->', fileUri.toString());

                        // Create a BinaryBuffer for the file content
                        const contentBuffer = BinaryBuffer.fromString(content); // Empty content for the new file

                        // Directly create the file with the content buffer
                        await this.fileService.createFile(fileUri, contentBuffer);
                        this.fireCreateNewFile({ parent: parentUri, uri: fileUri });

                        console.log('File successfully created at:', fileUri.toString());
                    } else {
                        console.warn('Parent directory could not be found or is invalid.');
                    }
                } catch (error) {
                    console.error('Error creating file:', error);
                }
            }
        });

        // Not visible/enabled on Windows/Linux in electron.
        commands.registerCommand(WorkspaceCommands.OPEN, {
            isEnabled: () => isOSX || !this.isElectron(),
            isVisible: () => isOSX || !this.isElectron(),
            execute: () => this.doOpen()
        });
        // Visible/enabled only on Windows/Linux in electron.
        commands.registerCommand(WorkspaceCommands.OPEN_FILE, {
            isEnabled: () => true,
            execute: () => this.doOpenFile()
        });
        // Visible/enabled only on Windows/Linux in electron.
        commands.registerCommand(WorkspaceCommands.OPEN_FOLDER, {
            isEnabled: () => true,
            execute: () => this.doOpenFolder()
        });
        commands.registerCommand(WorkspaceCommands.OPEN_SMART_CONTRACT, {
            isEnabled: () => true,
            execute: (folderLink: string) => this.doOpenSmartContract(folderLink)
        });
        commands.registerCommand(WorkspaceCommands.OPEN_WORKSPACE, {
            isEnabled: () => true,
            execute: () => this.doOpenWorkspace()
        });
        commands.registerCommand(WorkspaceCommands.CLOSE, {
            isEnabled: () => this.workspaceService.opened,
            execute: () => this.closeWorkspace()
        });
        commands.registerCommand(WorkspaceCommands.OPEN_RECENT_WORKSPACE, {
            execute: () => this.quickOpenWorkspace.select()
        });
        commands.registerCommand(WorkspaceCommands.SAVE_WORKSPACE_AS, {
            isVisible: () => this.workspaceService.opened,
            isEnabled: () => this.workspaceService.opened,
            execute: () => this.saveWorkspaceAs()
        });
        commands.registerCommand(WorkspaceCommands.OPEN_WORKSPACE_FILE, {
            isEnabled: () => this.workspaceService.saved,
            execute: () => {
                if (this.workspaceService.saved && this.workspaceService.workspace) {
                    open(this.openerService, this.workspaceService.workspace.resource);
                }
            }

        });
    }

    protected async getDirectory(candidate: URI): Promise<FileStat | undefined> {
        let stat: FileStat | undefined;
        try {
            stat = await this.fileService.resolve(candidate);
        } catch { }
        if (stat && stat.isDirectory) {
            return stat;
        }
        return this.getParent(candidate);
    }

    protected async getParent(candidate: URI): Promise<FileStat | undefined> {
        try {
            return await this.fileService.resolve(candidate.parent);
        } catch {
            return undefined;
        }
    }

    registerMenus(menus: MenuModelRegistry): void {
        if (isOSX || !this.isElectron()) {
            menus.registerMenuAction(CommonMenus.FILE_OPEN, {
                commandId: WorkspaceCommands.OPEN.id,
                order: 'a00'
            });
        }
        if (!isOSX && this.isElectron()) {
            menus.registerMenuAction(CommonMenus.FILE_OPEN, {
                commandId: WorkspaceCommands.OPEN_FILE.id,
                label: `${WorkspaceCommands.OPEN_FILE.dialogLabel}...`,
                order: 'a01'
            });
            menus.registerMenuAction(CommonMenus.FILE_OPEN, {
                commandId: WorkspaceCommands.OPEN_FOLDER.id,
                label: `${WorkspaceCommands.OPEN_FOLDER.dialogLabel}...`,
                order: 'a02'
            });
        }
        menus.registerMenuAction(CommonMenus.FILE_OPEN, {
            commandId: WorkspaceCommands.OPEN_WORKSPACE.id,
            order: 'a10'
        });
        menus.registerMenuAction(CommonMenus.FILE_OPEN, {
            commandId: WorkspaceCommands.OPEN_RECENT_WORKSPACE.id,
            order: 'a20'
        });

        menus.registerMenuAction(FILE_WORKSPACE, {
            commandId: WorkspaceCommands.ADD_FOLDER.id,
            order: 'a10'
        });
        menus.registerMenuAction(FILE_WORKSPACE, {
            commandId: WorkspaceCommands.SAVE_WORKSPACE_AS.id,
            order: 'a20'
        });

        menus.registerMenuAction(CommonMenus.FILE_CLOSE, {
            commandId: WorkspaceCommands.CLOSE.id
        });

        menus.registerMenuAction(CommonMenus.FILE_SAVE, {
            commandId: WorkspaceCommands.SAVE_AS.id,
        });

        menus.registerMenuAction(SHELL_TABBAR_CONTEXT_COPY, {
            commandId: WorkspaceCommands.COPY_RELATIVE_FILE_PATH.id,
            label: WorkspaceCommands.COPY_RELATIVE_FILE_PATH.label,
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({
            command: isOSX || !this.isElectron() ? WorkspaceCommands.OPEN.id : WorkspaceCommands.OPEN_FILE.id,
            keybinding: this.isElectron() ? 'ctrlcmd+o' : 'ctrlcmd+alt+o',
        });
        if (!isOSX && this.isElectron()) {
            keybindings.registerKeybinding({
                command: WorkspaceCommands.OPEN_FOLDER.id,
                keybinding: 'ctrl+k ctrl+o',
            });
        }
        keybindings.registerKeybinding({
            command: WorkspaceCommands.OPEN_WORKSPACE.id,
            keybinding: 'ctrlcmd+alt+w',
        });
        keybindings.registerKeybinding({
            command: WorkspaceCommands.OPEN_RECENT_WORKSPACE.id,
            keybinding: 'ctrlcmd+alt+r',
        });
        keybindings.registerKeybinding({
            command: WorkspaceCommands.SAVE_AS.id,
            keybinding: 'ctrlcmd+shift+s',
        });
        keybindings.registerKeybinding({
            command: WorkspaceCommands.COPY_RELATIVE_FILE_PATH.id,
            keybinding: isWindows ? 'ctrl+k ctrl+shift+c' : 'ctrlcmd+shift+alt+c',
            when: '!editorFocus'
        });
    }

    /**
     * This is the generic `Open` method. Opens files and directories too. Resolves to the opened URI.
     * Except when you are on either Windows or Linux `AND` running in electron. If so, it opens a file.
     */
    protected async doOpen(): Promise<URI[] | undefined> {
        if (!isOSX && this.isElectron()) {
            return this.doOpenFile();
        }
        const [rootStat] = await this.workspaceService.roots;
        let selectedUris = await this.fileDialogService.showOpenDialog({
            title: WorkspaceCommands.OPEN.dialogLabel,
            canSelectFolders: true,
            canSelectFiles: true,
            canSelectMany: true
        }, rootStat);
        if (selectedUris) {
            if (!Array.isArray(selectedUris)) {
                selectedUris = [selectedUris];
            }
            const folders: URI[] = [];
            //  Only open files then open all folders in a new workspace, as done with Electron see doOpenFolder.
            for (const uri of selectedUris) {
                const destination = await this.fileService.resolve(uri);
                if (destination.isDirectory) {
                    if (this.getCurrentWorkspaceUri()?.toString() !== uri.toString()) {
                        folders.push(uri);
                    }
                } else {
                    await open(this.openerService, uri);
                }
            }
            if (folders.length > 0) {
                const openableURI = await this.getOpenableWorkspaceUri(folders);
                if (openableURI && (!this.workspaceService.workspace || !openableURI.isEqual(this.workspaceService.workspace.resource))) {
                    this.workspaceService.open(openableURI);
                }
            }

            return selectedUris;
        }
        return undefined;
    }

    /**
     * Opens a set of files after prompting the `Open File` dialog. Resolves to `undefined`, if
     *  - the workspace root is not set,
     *  - the file to open does not exist, or
     *  - it was not a file, but a directory.
     *
     * Otherwise, resolves to the set of URIs of the files.
     */
    protected async doOpenFile(): Promise<URI[] | undefined> {
        const props: OpenFileDialogProps = {
            title: WorkspaceCommands.OPEN_FILE.dialogLabel,
            canSelectFolders: false,
            canSelectFiles: true,
            canSelectMany: true
        };
        const [rootStat] = await this.workspaceService.roots;
        let selectedFilesUris: MaybeArray<URI> | undefined = await this.fileDialogService.showOpenDialog(props, rootStat);
        if (selectedFilesUris) {
            if (!Array.isArray(selectedFilesUris)) {
                selectedFilesUris = [selectedFilesUris];
            }

            const result = [];
            for (const uri of selectedFilesUris) {
                const destination = await this.fileService.resolve(uri);
                if (destination.isFile) {
                    await open(this.openerService, uri);
                    result.push(uri);
                }
            }
            return result;
        }
        return undefined;
    }

    /**
     * Opens one or more folders after prompting the `Open Folder` dialog. Resolves to `undefined`, if
     *  - the user's selection is empty or contains only files.
     *  - the new workspace is equal to the old workspace.
     *
     * Otherwise, resolves to the URI of the new workspace:
     *  - a single folder if a single folder was selected.
     *  - a new, untitled workspace file if multiple folders were selected.
     */
    protected async doOpenFolder(): Promise<URI | undefined> {
        const props: OpenFileDialogProps = {
            title: WorkspaceCommands.OPEN_FOLDER.dialogLabel,
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: true,
        };
        const [rootStat] = await this.workspaceService.roots;
        const targetFolders = await this.fileDialogService.showOpenDialog(props, rootStat);
        console.log(targetFolders);
        if (targetFolders) {
            const openableUri = await this.getOpenableWorkspaceUri(targetFolders);
            console.log(openableUri);
            if (openableUri) {
                if (!this.workspaceService.workspace || !openableUri.isEqual(this.workspaceService.workspace.resource)) {
                    this.workspaceService.open(openableUri);
                    return openableUri;
                }
            };
        }
        return undefined;
    }

    protected async doOpenSmartContract(folderLink: string): Promise<URI | undefined> {
        // Convert folderLink to a URI object
        const targetFolderUri = new URI(`file:///${encodeURIComponent(folderLink.replace(/\\/g, '/'))}`);
        console.log(targetFolderUri);

        // Wrap the URI in an array to match the expected input type of getOpenableWorkspaceUri
        const openableUri = await this.getOpenableWorkspaceUri([targetFolderUri]);
        console.log(openableUri);

        if (openableUri) {
            if (!this.workspaceService.workspace || !openableUri.isEqual(this.workspaceService.workspace.resource)) {
                this.workspaceService.open(openableUri);
                return openableUri;
            }
        }
        return undefined;
    }

    protected async getOpenableWorkspaceUri(uris: MaybeArray<URI>): Promise<URI | undefined> {
        if (Array.isArray(uris)) {
            if (uris.length < 2) {
                return uris[0];
            } else {
                const foldersToOpen = (await Promise.all(uris.map(uri => this.fileService.resolve(uri))))
                    .filter(fileStat => !!fileStat?.isDirectory);
                if (foldersToOpen.length === 1) {
                    return foldersToOpen[0].resource;
                } else {
                    return this.createMultiRootWorkspace(foldersToOpen);
                }
            }
        } else {
            return uris;
        }
    }

    protected async createMultiRootWorkspace(roots: FileStat[]): Promise<URI> {
        const untitledWorkspace = await this.workspaceService.getUntitledWorkspace();
        const folders = Array.from(new Set(roots.map(stat => stat.resource.path.toString())), path => ({ path }));
        const workspaceStat = await this.fileService.createFile(
            untitledWorkspace,
            BinaryBuffer.fromString(JSON.stringify({ folders }, null, 4)), // eslint-disable-line no-null/no-null
            { overwrite: true }
        );
        return workspaceStat.resource;
    }

    /**
     * Opens a workspace after raising the `Open Workspace` dialog. Resolves to the URI of the recently opened workspace,
     * if it was successful. Otherwise, resolves to `undefined`.
     */
    protected async doOpenWorkspace(): Promise<URI | undefined> {
        const props = {
            title: WorkspaceCommands.OPEN_WORKSPACE.dialogLabel,
            canSelectFiles: true,
            canSelectFolders: false,
            filters: this.getWorkspaceDialogFileFilters()
        };
        const [rootStat] = await this.workspaceService.roots;
        const workspaceFileUri = await this.fileDialogService.showOpenDialog(props, rootStat);
        if (workspaceFileUri &&
            this.getCurrentWorkspaceUri()?.toString() !== workspaceFileUri.toString()) {
            if (await this.fileService.exists(workspaceFileUri)) {
                this.workspaceService.open(workspaceFileUri);
                return workspaceFileUri;
            }
        }
        return undefined;
    }

    protected async closeWorkspace(): Promise<void> {
        await this.workspaceService.close();
    }

    /**
     * @returns whether the file was successfully saved.
     */
    protected async saveWorkspaceAs(): Promise<boolean> {
        let exist: boolean = false;
        let overwrite: boolean = false;
        let selected: URI | undefined;
        do {
            selected = await this.fileDialogService.showSaveDialog({
                title: WorkspaceCommands.SAVE_WORKSPACE_AS.label!,
                filters: this.getWorkspaceDialogFileFilters()
            });
            if (selected) {
                const displayName = selected.displayName;
                const extensions = this.workspaceFileService.getWorkspaceFileExtensions(true);
                if (!extensions.some(ext => displayName.endsWith(ext))) {
                    const defaultExtension = extensions[this.workspaceFileService.defaultFileTypeIndex];
                    selected = selected.parent.resolve(`${displayName}${defaultExtension}`);
                }
                exist = await this.fileService.exists(selected);
                if (exist) {
                    overwrite = await this.saveService.confirmOverwrite(selected);
                }
            }
        } while (selected && exist && !overwrite);

        if (selected) {
            try {
                await this.workspaceService.save(selected);
                return true;
            } catch {
                this.messageService.error(nls.localizeByDefault("Unable to save workspace '{0}'", selected.path.fsPath()));
            }
        }
        return false;
    }

    canBeSavedAs(widget: Widget | undefined): widget is Widget & SaveableSource & Navigatable {
        return this.saveService.canSaveAs(widget);
    }

    async saveAs(widget: Widget & SaveableSource & Navigatable): Promise<void> {
        await this.saveService.saveAs(widget);
    }

    protected updateWorkspaceStateKey(): WorkspaceState {
        return this.doUpdateState();
    }

    protected updateWorkbenchStateKey(): WorkbenchState {
        return this.doUpdateState();
    }

    protected doUpdateState(): WorkspaceState | WorkbenchState {
        if (this.workspaceService.opened) {
            return this.workspaceService.isMultiRootWorkspaceOpened ? 'workspace' : 'folder';
        }
        return 'empty';
    }

    protected getWorkspaceDialogFileFilters(): FileDialogTreeFilters {
        const filters: FileDialogTreeFilters = {};
        for (const fileType of this.workspaceFileService.getWorkspaceFileTypes()) {
            filters[`${nls.localizeByDefault('{0} workspace', fileType.name)} (*.${fileType.extension})`] = [fileType.extension];
        }
        return filters;
    }

    private isElectron(): boolean {
        return environment.electron.is();
    }

    /**
     * Get the current workspace URI.
     *
     * @returns the current workspace URI.
     */
    private getCurrentWorkspaceUri(): URI | undefined {
        return this.workspaceService.workspace?.resource;
    }

    onWillStop(): OnWillStopAction<boolean> | undefined {
        const { workspace } = this.workspaceService;
        if (workspace && this.workspaceService.isUntitledWorkspace(workspace.resource)) {
            return {
                prepare: async reason => reason === StopReason.Reload && this.workspaceService.isSafeToReload(workspace.resource),
                action: async alreadyConfirmedSafe => {
                    if (alreadyConfirmedSafe) {
                        return true;
                    }
                    const shouldSaveFile = await new UntitledWorkspaceExitDialog({
                        title: nls.localizeByDefault('Do you want to save your workspace configuration as a file?')
                    }).open();
                    if (shouldSaveFile === "Don't Save") {
                        return true;
                    } else if (shouldSaveFile === 'Save') {
                        return this.saveWorkspaceAs();
                    }
                    return false; // If cancel, prevent exit.

                },
                reason: 'Untitled workspace.',
                // Since deleting the workspace would hobble any future functionality, run this late.
                priority: 100,
            };
        }
    }
}

export namespace WorkspaceFrontendContribution {

    /**
     * File filter for all Theia and VS Code workspace file types.
     *
     * @deprecated Since 1.39.0 Use `WorkspaceFrontendContribution#getWorkspaceDialogFileFilters` instead.
     */
    export const DEFAULT_FILE_FILTER: FileDialogTreeFilters = {
        'Theia Workspace (*.theia-workspace)': [THEIA_EXT],
        'VS Code Workspace (*.code-workspace)': [VSCODE_EXT]
    };
}
