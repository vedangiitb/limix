// *****************************************************************************
// Copyright (C) 2018 Ericsson and others.
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

import { codicon, CommonCommands, Key, KeyCode, LabelProvider, Message, ReactWidget } from '@theia/core/lib/browser';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { CommandRegistry, environment, isOSX, Path } from '@theia/core/lib/common';
import { ApplicationInfo, ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { nls } from '@theia/core/lib/common/nls';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { KeymapsCommands } from '@theia/keymaps/lib/browser';
import { WorkspaceCommands, WorkspaceService } from '@theia/workspace/lib/browser';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import { anchorTomlContent, cargoTomlContent, programRsContent, testTsContent } from './skeleton-content';
/**
 * Default implementation of the `GettingStartedWidget`.
 * The widget is displayed when there are currently no workspaces present.
 * Some of the features displayed include:
 * - `start smart contract` commands.
 * - `recently accessed smart contracts`.
 * - `settings` commands.
 */
@injectable()
export class GettingStartedWidget extends ReactWidget {

    /**
     * The widget `id`.
     */
    static readonly ID = 'getting.started.widget';
    /**
     * The widget `label` which is used for display purposes.
     */
    static readonly LABEL = nls.localizeByDefault('Welcome');

    /**
     * The `ApplicationInfo` for the application if available.
     * Used in order to obtain the version number of the application.
     */
    protected applicationInfo: ApplicationInfo | undefined;
    /**
     * The application name which is used for display purposes.
     */
    protected applicationName = FrontendApplicationConfigProvider.get().applicationName;

    protected home: string | undefined;

    /**
     * The recently used workspaces limit.
     * Used in order to limit the number of recently used workspaces to display.
     */
    protected recentLimit = 5;
    /**
     * The list of recently used workspaces.
     */
    protected recentWorkspaces: string[] = [];

    /**
     * Indicates whether the "ai-core" extension is available.
     */
    protected aiIsIncluded: boolean;

    /**
     * Collection of useful links to display for end users.
     */
    protected readonly theiaAIDocUrl = 'https://theia-ide.org/docs/user_ai/';
    protected readonly ghProjectUrl = 'https://github.com/eclipse-theia/theia/issues/new/choose';

    protected projectName: string = '';
    protected blockchain: string = '';
    protected language: string = '';
    protected isDialogOpen: boolean = false;
    protected path: string = 'C:';

    @inject(ApplicationServer)
    protected readonly appServer: ApplicationServer;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(EnvVariablesServer)
    protected readonly environments: EnvVariablesServer;

    @inject(LabelProvider)
    protected readonly labelProvider: LabelProvider;

    @inject(WindowService)
    protected readonly windowService: WindowService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(FileDialogService)
    protected readonly fileDialogService: FileDialogService;

    @postConstruct()
    protected init(): void {
        this.doInit();
    }

    protected async doInit(): Promise<void> {
        this.id = GettingStartedWidget.ID;
        this.title.label = GettingStartedWidget.LABEL;
        this.title.caption = GettingStartedWidget.LABEL;
        this.title.closable = true;

        this.applicationInfo = await this.appServer.getApplicationInfo();
        this.recentWorkspaces = await this.workspaceService.recentWorkspaces();
        this.home = new URI(await this.environments.getHomeDirUri()).path.toString();

        const extensions = await this.appServer.getExtensionsInfos();
        this.aiIsIncluded = extensions.find(ext => ext.name === '@theia/ai-core') !== undefined;
        this.update();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        const elArr = this.node.getElementsByTagName('a');
        if (elArr && elArr.length > 0) {
            (elArr[0] as HTMLElement).focus();
        }
    }

    /**
     * Render the content of the widget.
     */
    protected render(): React.ReactNode {
        return <div className='gs-container'>
            <div className='gs-content-container'>
                {this.aiIsIncluded &&
                    <div className='gs-float shadow-pulse'>
                        {this.renderAIBanner()}
                    </div>
                }
                {this.renderHeader()}
                <hr className='gs-hr' />
                <div className='flex-grid'>
                    <div className='col'>
                        {this.renderStart()}
                    </div>
                </div>
                <div className='flex-grid'>
                    <div className='col'>
                        {this.renderRecentWorkspaces()}
                    </div>
                </div>
                <div className='flex-grid'>
                    <div className='col'>
                        {this.renderSettings()}
                    </div>
                </div>
                <div className='flex-grid'>
                    <div className='col'>
                        {this.renderVersion()}
                    </div>
                </div>
            </div>

            <div style={{ position: 'absolute', top: 10, left: 10 }}>
                {this.isDialogOpen && this.renderDialogBox()}
            </div>
        </div>;
    }

    /**
     * Render the widget header.
     * Renders the title `{applicationName} Getting Started`.
     */
    protected renderHeader(): React.ReactNode {
        return <div className='gs-header'>
            <h1>{this.applicationName}<span className='gs-sub-header'>{' ' + GettingStartedWidget.LABEL}</span></h1>
        </div>;
    }

    /**
     * Render the `Start` section.
     * Displays a collection of "start-to-work" related commands like `open` commands and some other.
     */
    protected renderStart(): React.ReactNode {
        const requireSingleOpen = isOSX || !environment.electron.is();

        const createProject = <div className='gs-action-container'>
            <a
                role={'button'}
                tabIndex={0}
                onClick={this.toggleDialog}
                onKeyDown={this.toggleDialogEnter}>
                {/* {CommonCommands.NEW_UNTITLED_FILE.label ?? nls.localizeByDefault('New File...')} */}
                New Smart Contract
            </a>
        </div>;

        const openFolder = !requireSingleOpen && <div className='gs-action-container'>
            <a
                role={'button'}
                tabIndex={0}
                onClick={this.doOpenFolder}
                onKeyDown={this.doOpenFolderEnter}>
                {nls.localizeByDefault('Open Folder')}
            </a>
        </div>;

        const importFromGit = !requireSingleOpen && <div className='gs-action-container'>
            <a
                role={'button'}
                tabIndex={0}
                onClick={this.doOpenFromGit}
                onKeyDown={this.doOpenFromGitEnter}>
                Import From Git
            </a>
        </div>;

        return <div className='gs-section'>
            <h3 className='gs-section-header'><i className={codicon('folder-opened')}></i>{nls.localizeByDefault('Start')}</h3>
            {createProject}
            {openFolder}
            {importFromGit}
        </div>;
    }

    /**
     * Render the recently used workspaces section.
     */
    protected renderRecentWorkspaces(): React.ReactNode {
        const items = this.recentWorkspaces;
        const paths = this.buildPaths(items);
        const content = paths.slice(0, this.recentLimit).map((item, index) =>
            <div className='gs-action-container' key={index}>
                <a
                    role={'button'}
                    tabIndex={0}
                    onClick={() => this.open(new URI(items[index]))}
                    onKeyDown={(e: React.KeyboardEvent) => this.openEnter(e, new URI(items[index]))}>
                    {new URI(items[index]).path.base}
                </a>
                <span className='gs-action-details'>
                    {item}
                </span>
            </div>
        );
        // If the recently used workspaces list exceeds the limit, display `More...` which triggers the recently used workspaces quick-open menu upon selection.
        const more = paths.length > this.recentLimit && <div className='gs-action-container'>
            <a
                role={'button'}
                tabIndex={0}
                onClick={this.doOpenRecentWorkspace}
                onKeyDown={this.doOpenRecentWorkspaceEnter}>
                {nls.localizeByDefault('More...')}
            </a>
        </div>;
        return <div className='gs-section'>
            <h3 className='gs-section-header'>
                <i className={codicon('history')}></i>Recently Opened Smart Contracts
            </h3>
            {items.length > 0 ? content : <p className='gs-no-recent'>
                {nls.localizeByDefault('You have no recent folders,') + ' '}
                <a
                    role={'button'}
                    tabIndex={0}
                    onClick={this.doOpenFolder}
                    onKeyDown={this.doOpenFolderEnter}>
                    {nls.localizeByDefault('open a folder')}
                </a>
                {' ' + nls.localizeByDefault('to start.')}
            </p>}
            {more}
        </div>;
    }

    /**
     * Render the settings section.
     * Generally used to display useful links.
     */
    protected renderSettings(): React.ReactNode {
        return <div className='gs-section'>
            <h3 className='gs-section-header'>
                <i className={codicon('settings-gear')}></i>
                {nls.localizeByDefault('Settings')}
            </h3>
            <div className='gs-action-container'>
                <a
                    role={'button'}
                    tabIndex={0}
                    onClick={this.doOpenPreferences}
                    onKeyDown={this.doOpenPreferencesEnter}>
                    {nls.localizeByDefault('Open Settings')}
                </a>
            </div>
            <div className='gs-action-container'>
                <a
                    role={'button'}
                    tabIndex={0}
                    onClick={this.doOpenKeyboardShortcuts}
                    onKeyDown={this.doOpenKeyboardShortcutsEnter}>
                    {nls.localizeByDefault('Open Keyboard Shortcuts')}
                </a>
            </div>
        </div>;
    }
    /**
     * Render the version section.
     */
    protected renderVersion(): React.ReactNode {
        return <div className='gs-section'>
            <div className='gs-action-container'>
                <p className='gs-sub-header' >
                    {this.applicationInfo ? nls.localizeByDefault('Version: {0}', this.applicationInfo.version) : ''}
                </p>
            </div>
        </div>;
    }

    // Todo: We will have something like a tutorial or guide here
    protected renderAIBanner(): React.ReactNode {
        return <div className='gs-container gs-experimental-container'>
            <div className='flex-grid'>
                <div className='col'>
                    <h3 className='gs-section-header'> Get Started with Limix AI IDE 🚀  </h3>
                    <br />
                    <div className='gs-action-container'>
                        Theia IDE now contains experimental AI support, which offers early access to cutting-edge AI capabilities within your IDE.
                        <br />
                        <br />
                        Please note that these features are disabled by default, ensuring that users can opt-in at their discretion.
                        For those who choose to enable AI support, it is important to be aware that these experimental features may generate continuous
                        requests to the language models (LLMs) you provide access to. This might incur costs that you need to monitor closely.
                        <br />
                        For more details, please visit &nbsp;
                        <a
                            role={'button'}
                            tabIndex={0}
                            onClick={() => this.doOpenExternalLink(this.theiaAIDocUrl)}
                            onKeyDown={(e: React.KeyboardEvent) => this.doOpenExternalLinkEnter(e, this.theiaAIDocUrl)}>
                            {'the documentation'}
                        </a>.
                        <br />
                        <br />
                        🚧 Please note that this feature is currently in development and may undergo frequent changes.
                        We welcome your feedback, contributions, and sponsorship! To support the ongoing development of the AI capabilities please visit the&nbsp;
                        <a
                            role={'button'}
                            tabIndex={0}
                            onClick={() => this.doOpenExternalLink(this.ghProjectUrl)}
                            onKeyDown={(e: React.KeyboardEvent) => this.doOpenExternalLinkEnter(e, this.ghProjectUrl)}>
                            {'Github Project'}
                        </a>.
                        &nbsp;Thank you for being part of our community!
                    </div>
                    <br />
                    <div className='gs-action-container'>
                        <a
                            role={'button'}
                            style={{ fontSize: 'var(--theia-ui-font-size2)' }}
                            tabIndex={0}
                            onClick={() => this.doOpenAIChatView()}
                            onKeyDown={(e: React.KeyboardEvent) => this.doOpenAIChatViewEnter(e)}>
                            {'Open the AI Chat View now to learn how to start! ✨'}
                        </a>
                    </div>
                    <br />
                    <br />
                </div>
            </div>
        </div>;
    }

    protected renderDialogBox(): React.ReactNode {
        // Define a condition to check if all required fields are filled
        const isCreateButtonDisabled = !this.projectName || !this.blockchain || !this.language;
        return (
            <div className='dialog-overlay'>
                <div className='dialog-box'>
                    <div className='dialog-title'>
                        <h3>Select Project Configurations</h3>
                    </div>
                    <form className='dialog-form'>
                        <label>
                            Project Name:
                            <input
                                type='text'
                                value={this.projectName}
                                onChange={e => this.handleInputChange('projectName', e.target.value)}
                            />
                        </label>
                        <label>
                            Blockchain:
                            <select value={this.blockchain} onChange={e => this.handleInputChange('blockchain', e.target.value)}>
                                <option value=''>Select Blockchain</option>
                                <option value='Ethereum'>Ethereum</option>
                                <option value='Solana'>Solana</option>
                            </select>
                        </label>
                        <label>
                            Language:
                            <select value={this.language} onChange={e => this.handleInputChange('language', e.target.value)}>
                                <option value=''>Select Framework</option>
                                {this.blockchain === 'Ethereum' && <option value='Solidity'>Solidity</option>}
                                {this.blockchain === 'Ethereum' && <option value='Vyper'>Vyper</option>}
                                {this.blockchain === 'Solana' && <option value='Native (Rust)'>Native (Rust)</option>}
                                {this.blockchain === 'Solana' && <option value='Anchor (Rust)'>Anchor (Rust)</option>}
                                {this.blockchain === 'Solana' && <option value='Seahorse (Python)'>Seahorse (Python)</option>}
                            </select>
                        </label>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <input
                                type="text"
                                value={this.path}
                                onChange={e => this.path = e.target.value}
                                style={{ flex: 1, padding: '8px', fontSize: '16px' }}
                            />
                            <button
                                type="button"
                                onClick={this.openFolderDialog}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '8px',
                                    display: 'flex',
                                    alignItems: 'center'
                                }}
                            >
                                <span className="fa fa-folder-open" style={{ fontSize: '24px', color: 'gray' }} />
                            </button>
                        </div>
                        <div className='dialog-buttons'>
                            <button
                                type='button'
                                onClick={() => this.doCreateContract(this.path, this.projectName)}
                                disabled={isCreateButtonDisabled} // Disable button based on the condition
                            >
                                Create Project
                            </button>
                            <button type='button' onClick={this.toggleDialog}>Cancel</button>
                        </div>
                    </form>
                </div>
            </div>
        );
    };

    protected doOpenAIChatView = () => this.commandRegistry.executeCommand('aiChat:toggle');
    protected doOpenAIChatViewEnter = (e: React.KeyboardEvent) => {
        if (this.isEnterKey(e)) {
            this.doOpenAIChatView();
        }
    };

    /**
     * Build the list of workspace paths.
     * @param workspaces {string[]} the list of workspaces.
     * @returns {string[]} the list of workspace paths.
     */
    protected buildPaths(workspaces: string[]): string[] {
        const paths: string[] = [];
        workspaces.forEach(workspace => {
            const uri = new URI(workspace);
            const pathLabel = this.labelProvider.getLongName(uri);
            const path = this.home ? Path.tildify(pathLabel, this.home) : pathLabel;
            paths.push(path);
        });
        return paths;
    }

    /**
     * Trigger the create file command.
     */
    // eslint-disable-next-line @typescript-eslint/tslint/config
    protected async doCreateContract(targetDirectory: string, folderName: string) {
        try {
            await this.commandRegistry.executeCommand(WorkspaceCommands.NEW_CONTRACT_FOLDER.id, targetDirectory, folderName);

            const projectFolderPath = `${targetDirectory}/${folderName}`;

            const anchorToml = anchorTomlContent.replace(/{folderName}/g, folderName);
            const cargoToml = cargoTomlContent.replace(/{folderName}/g, folderName);
            const programRs = programRsContent.replace(/{folderName}/g, folderName);
            const testTs = testTsContent.replace(/{folderName}/g, folderName);

            if (this.blockchain === 'Solana') {
                await this.commandRegistry.executeCommand(WorkspaceCommands.NEW_CONTRACT_FILE.id, projectFolderPath, 'Anchor.toml', anchorToml);
                await this.commandRegistry.executeCommand(WorkspaceCommands.NEW_CONTRACT_FILE.id, projectFolderPath, 'Cargo.toml', cargoToml);
                await this.commandRegistry.executeCommand(WorkspaceCommands.NEW_CONTRACT_FOLDER.id, projectFolderPath, 'program');
                await this.commandRegistry.executeCommand(WorkspaceCommands.NEW_CONTRACT_FILE.id, `${projectFolderPath}/program`, `${folderName}.rs`, programRs);
                await this.commandRegistry.executeCommand(WorkspaceCommands.NEW_CONTRACT_FOLDER.id, projectFolderPath, 'tests');
                await this.commandRegistry.executeCommand(WorkspaceCommands.NEW_CONTRACT_FILE.id, `${projectFolderPath}/tests`, `${folderName}.ts`, testTs);

                console.log('Solana project structure created successfully.');

                await this.commandRegistry.executeCommand(WorkspaceCommands.OPEN_SMART_CONTRACT.id, projectFolderPath);
            }

        } catch (error) {
            console.error('Error creating contract structure:', error);
        }
    }

    /**
     * Trigger the open folder command.
     */
    protected doOpenFolder = () => this.commandRegistry.executeCommand(WorkspaceCommands.OPEN_FOLDER.id);
    protected doOpenFolderEnter = (e: React.KeyboardEvent) => {
        if (this.isEnterKey(e)) {
            this.doOpenFolder();
        }
    };

    // Todo: Implement this feature
    protected doOpenFromGit = () => this.commandRegistry.executeCommand(WorkspaceCommands.OPEN_FOLDER.id);
    protected doOpenFromGitEnter = (e: React.KeyboardEvent) => {
        if (this.isEnterKey(e)) {
            this.doOpenFolder();
        }
    };

    /**
     * Trigger the open recent workspace command.
     */
    protected doOpenRecentWorkspace = () => this.commandRegistry.executeCommand(WorkspaceCommands.OPEN_RECENT_WORKSPACE.id);
    protected doOpenRecentWorkspaceEnter = (e: React.KeyboardEvent) => {
        if (this.isEnterKey(e)) {
            this.doOpenRecentWorkspace();
        }
    };

    /**
     * Trigger the open preferences command.
     * Used to open the preferences widget.
     */
    protected doOpenPreferences = () => this.commandRegistry.executeCommand(CommonCommands.OPEN_PREFERENCES.id);
    protected doOpenPreferencesEnter = (e: React.KeyboardEvent) => {
        if (this.isEnterKey(e)) {
            this.doOpenPreferences();
        }
    };

    /**
     * Trigger the open keyboard shortcuts command.
     * Used to open the keyboard shortcuts widget.
     */
    protected doOpenKeyboardShortcuts = () => this.commandRegistry.executeCommand(KeymapsCommands.OPEN_KEYMAPS.id);
    protected doOpenKeyboardShortcutsEnter = (e: React.KeyboardEvent) => {
        if (this.isEnterKey(e)) {
            this.doOpenKeyboardShortcuts();
        }
    };

    /**
     * Open a workspace given its uri.
     * @param uri {URI} the workspace uri.
     */
    protected open = (uri: URI) => this.workspaceService.open(uri);
    protected openEnter = (e: React.KeyboardEvent, uri: URI) => {
        if (this.isEnterKey(e)) {
            this.open(uri);
        }
    };

    /**
     * Open a link in an external window.
     * @param url the link.
     */
    protected doOpenExternalLink = (url: string) => this.windowService.openNewWindow(url, { external: true });
    protected doOpenExternalLinkEnter = (e: React.KeyboardEvent, url: string) => {
        if (this.isEnterKey(e)) {
            this.doOpenExternalLink(url);
        }
    };

    protected isEnterKey(e: React.KeyboardEvent): boolean {
        return Key.ENTER.keyCode === KeyCode.createKeyCode(e.nativeEvent).key?.keyCode;
    }

    // Method to handle form input changes
    protected handleInputChange = (field: 'projectName' | 'blockchain' | 'language' | 'path', value: string): void => {
        this[field] = value;
        this.update();
    };

    // Method to toggle the dialog visibility
    protected toggleDialog = (): void => {
        this.isDialogOpen = !this.isDialogOpen;
        this.update();
    };
    protected toggleDialogEnter = (e: React.KeyboardEvent) => {
        if (this.isEnterKey(e)) {
            this.toggleDialog();
        }
    };

    // Method to create project folder
    protected async createProject(): Promise<void> {
        const { projectName, blockchain, language } = this;
        console.log(`Creating project: ${projectName}, Blockchain: ${blockchain}, Language: ${language}`);
        this.toggleDialog();
        this.resetContractProperties();
    }

    protected resetContractProperties = (): void => {
        this.projectName = '';
        this.blockchain = '';
        this.language = '';
    };

    protected openFolderDialog = async () => {
        // Use FileDialogService to open a directory selection dialog
        const selectedFolder = await this.fileDialogService.showOpenDialog({
            title: 'Select a Folder',
            canSelectFolders: true,
            canSelectFiles: false
        });

        if (selectedFolder) {
            console.log(selectedFolder);
            this.path = selectedFolder.path.toString().slice(1);
            console.log(this.path);
            this.update(); // Re-render the component with the new path
        }
    };

}
