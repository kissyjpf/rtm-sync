
import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl, TFile, TFolder } from 'obsidian';
import md5 from 'md5';


declare const BUILD_TIME: string;

// --- Configuration ---
const RTM_AUTH_URL = 'https://www.rememberthemilk.com/services/auth/';
const RTM_REST_URL = 'https://api.rememberthemilk.com/services/rest/';

interface RtmPluginSettings {
	apiKey: string;
	sharedSecret: string;
	authToken: string;
	defaultDueForNewTask: 'none' | 'today';
	noteCreationFolder: string;
	importWithNotesAndLink: boolean;
}

const DEFAULT_SETTINGS: RtmPluginSettings = {
	apiKey: '',
	sharedSecret: '',
	authToken: '',
	defaultDueForNewTask: 'none',
	noteCreationFolder: '',
	importWithNotesAndLink: false
}

// 内部で扱うタスク情報の構造
interface FormattedTask {
	name: string;
	due: string;
	start: string;
	priority: string;
	listName: string;
	tags: string[];
	notes: string[];
	rtmId: { list: string; series: string; task: string };
	rawPriority: string; 
	rawDue: string;      
}

export default class RtmPlugin extends Plugin {
	settings: RtmPluginSettings;
	timeline: string | null = null; 

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new RtmSettingTab(this.app, this));

		// 1. Download (Editor Insert) - All Incomplete
		this.addCommand({
			id: 'import-rtm-tasks',
			name: 'Download all incomplete tasks',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (!this.checkAuth()) return;
				await this.fetchAndProcessTasks('status:incomplete', false, (tasks) => {
					this.insertTasksToEditor(editor, tasks);
				});
			}
		});

		// 2. Download (Editor Insert) - Select
		this.addCommand({
			id: 'select-rtm-tasks',
			name: 'Select and import tasks',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (!this.checkAuth()) return;
				await this.fetchAndProcessTasks('status:incomplete', true, (tasks) => {
					this.insertTasksToEditor(editor, tasks);
				});
			}
		});

		// 3. Download (Editor Insert) - Custom Filter
		this.addCommand({
			id: 'import-rtm-tasks-custom',
			name: 'Download tasks (Custom Filter)',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (!this.checkAuth()) return;
				new FilterModal(this.app, async (result) => {
					await this.fetchAndProcessTasks(result, true, (tasks) => {
						this.insertTasksToEditor(editor, tasks);
					});
				}).open();
			}
		});

		// 4. Create Note from Task
		this.addCommand({
			id: 'create-note-from-rtm-task',
			name: 'Create note from RTM task',
			callback: async () => {
				if (!this.checkAuth()) return;
				await this.fetchAndProcessTasks('status:incomplete', true, (tasks) => {
					this.createNotesFromTasks(tasks);
				});
			}
		});

		// 5. Add Task (viewを渡す)
		this.addCommand({
			id: 'add-rtm-task',
			name: 'Add cursor line to RTM',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (!this.checkAuth()) return;
				await this.addTaskFromEditor(editor, view);
			}
		});

		// 6. Complete Task
		this.addCommand({
			id: 'complete-rtm-task',
			name: 'Complete task at cursor',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				if (!this.checkAuth()) return;
				await this.completeTaskInEditor(editor);
			}
		});
	}

	checkAuth(): boolean {
		if (!this.settings.apiKey || !this.settings.sharedSecret) {
			new Notice('Please set your API Key and Secret in settings.');
			return false;
		}
		if (!this.settings.authToken) {
			new Notice('Please authenticate with RTM from settings.');
			return false;
		}
		return true;
	}

	// Helper: リスト名取得
	async fetchListsMap(): Promise<Record<string, string>> {
		const map: Record<string, string> = {};
		try {
			const res = await this.callRtmApi('rtm.lists.getList');
			if (res.rsp.lists && res.rsp.lists.list) {
				const lists = Array.isArray(res.rsp.lists.list) ? res.rsp.lists.list : [res.rsp.lists.list];
				for (const l of lists) {
					if (l && l.id && l.name) map[l.id] = l.name;
				}
			}
		} catch (e) { console.error("List fetch error:", e); }
		return map;
	}

	// Core Logic
	async fetchAndProcessTasks(filterStr: string, showSelectionUI: boolean, onSelected: (tasks: FormattedTask[]) => void) {
		new Notice(`Fetching tasks...`);
		try {
			const listMap = await this.fetchListsMap();
			const response = await this.callRtmApi('rtm.tasks.getList', { filter: filterStr, notes: '1' });

			if (!response.rsp.tasks || !response.rsp.tasks.list) {
				new Notice('No tasks found.');
				return;
			}

			const parsedTasks: FormattedTask[] = [];
			const lists = Array.isArray(response.rsp.tasks.list) ? response.rsp.tasks.list : [response.rsp.tasks.list];

			for (const list of lists) {
				if (!list.taskseries) continue;
				const seriesArray = Array.isArray(list.taskseries) ? list.taskseries : [list.taskseries];
				
				for (const s of seriesArray) {
					const name = s.name;
					const task = Array.isArray(s.task) ? s.task[0] : s.task;
					
					let realListId = list.id;
					if (!realListId && s.list_id) realListId = s.list_id;
					if (!realListId) realListId = "MISSING"; 

					let dueDisplay = "";
					if (task.due && task.due !== "") {
						const datePart = task.due.split('T')[0];
						dueDisplay = `📅 ${datePart}`;
					}

					let startDisplay = "";
					if (task.start && task.start !== "") {
						const startPart = task.start.split('T')[0];
						startDisplay = `🛫 ${startPart}`;
					}

					let priDisplay = "";
					switch (task.priority) {
						case '1': priDisplay = "🔺"; break;
						case '2': priDisplay = "🔼"; break;
						case '3': priDisplay = "🔽"; break;
					}

					let listNameDisplay = "";
					const listName = listMap[realListId];
					if (listName) listNameDisplay = listName;

					const tagArray: string[] = [];
					if (s.tags && s.tags.tag) {
						const rawTags = Array.isArray(s.tags.tag) ? s.tags.tag : [s.tags.tag];
						rawTags.forEach((t: string) => tagArray.push(t));
					}

					const noteArray: string[] = [];
					if (s.notes && s.notes.note) {
						const rawNotes = Array.isArray(s.notes.note) ? s.notes.note : [s.notes.note];
						rawNotes.forEach((n: any) => {
							const text = n.$t || n.toString(); 
							if (text) noteArray.push(text);
						});
					}

					parsedTasks.push({
						name: name,
						due: dueDisplay,
						start: startDisplay,
						priority: priDisplay,
						listName: listNameDisplay,
						tags: tagArray,
						notes: noteArray,
						rtmId: { list: realListId, series: s.id, task: task.id },
						rawPriority: task.priority,
						rawDue: task.due
					});
				}
			}

			if (showSelectionUI) {
				new TaskImportModal(this.app, parsedTasks, (selectedTasks) => {
					onSelected(selectedTasks);
				}).open();
			} else {
				onSelected(parsedTasks);
			}

		} catch (e) { console.error(e); new Notice('Fetch error.'); }
	}

	insertTasksToEditor(editor: Editor, tasks: FormattedTask[]) {
		if (tasks.length === 0) { new Notice("No tasks selected."); return; }

		let textToInsert = "";
		for (const t of tasks) {
			let listTag = "";
			if (t.listName) {
				const safeName = t.listName.replace(/[\s,.]+/g, '_');
				listTag = ` #${safeName}`;
			}
			const tagsStr = t.tags.map(tag => ` #${tag}`).join("");
			const idTag = `[🐮](rtm:${t.rtmId.list}:${t.rtmId.series}:${t.rtmId.task})`;
			const priStr = t.priority ? ` ${t.priority}` : "";
			const dueStr = t.due ? ` ${t.due}` : "";
			textToInsert += `- [ ] ${idTag} ${t.name}${priStr}${dueStr}${listTag}${tagsStr}\n`;

			if (this.settings.importWithNotesAndLink) {
				const webLink = `https://www.rememberthemilk.com/app/#all/${t.rtmId.task}`;
				textToInsert += `    - RTM Link: ${webLink}\n`;
				if (t.notes && t.notes.length > 0) {
					t.notes.forEach(note => {
						const lines = note.split('\n');
						lines.forEach(line => {
							if (line.trim() !== '') {
								textToInsert += `    - Note: ${line}\n`;
							}
						});
					});
				}
			}
		}
		editor.replaceSelection(textToInsert);
		new Notice(`${tasks.length} tasks inserted.`);
	}

	async createNotesFromTasks(tasks: FormattedTask[]) {
		if (tasks.length === 0) { new Notice("No tasks selected."); return; }
		let createdCount = 0;
		for (const t of tasks) {
			const safeTitle = t.name.replace(/[\\/:*?"<>|]/g, '-');
			
			let folderPath = this.settings.noteCreationFolder.trim();
			if (folderPath.endsWith('/')) { folderPath = folderPath.slice(0, -1); }
			if (folderPath.startsWith('/')) { folderPath = folderPath.slice(1); }
			
			if (folderPath) {
				await this.ensureFolderExists(folderPath);
			}

			let filePath = folderPath ? `${folderPath}/${safeTitle}.md` : `${safeTitle}.md`;
			if (this.app.vault.getAbstractFileByPath(filePath)) {
				filePath = folderPath ? `${folderPath}/${safeTitle}-${Date.now()}.md` : `${safeTitle}-${Date.now()}.md`;
			}
			const tagsStr = t.tags.map(tag => `#${tag}`).join(" ");
			const listStr = t.listName ? `#${t.listName.replace(/[\s,.]+/g, '_')}` : "";
			
			let content = `# ${t.name}\n\n`;
			content += `- **RTM Link**: [🐮 Open Task](rtm:${t.rtmId.list}:${t.rtmId.series}:${t.rtmId.task})\n`;
			if (t.due) content += `- **Due**: ${t.due}\n`;
			if (t.start) content += `- **Start**: ${t.start}\n`;
			if (t.priority) content += `- **Priority**: ${t.priority}\n`;
			if (listStr || tagsStr) content += `- **Tags**: ${listStr} ${tagsStr}\n`;
			content += `\n---\n\n`;
			if (t.notes.length > 0) {
				content += `## Notes\n\n`;
				t.notes.forEach(note => { content += `${note}\n\n`; });
			} else { content += `(No notes in RTM)\n`; }

			try {
				await this.app.vault.create(filePath, content);
				createdCount++;
			} catch (e) {
				console.error(`Failed to create file: ${filePath}`, e);
				new Notice(`Failed to create note for "${t.name}"`);
			}
		}
		new Notice(`${createdCount} notes created.`);
	}

	// 5. Add Task
	async addTaskFromEditor(editor: Editor, view: MarkdownView) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const taskName = lineText.replace(/^[-*] \[[ x]\] /, '').replace(/^[-*] /, '').trim();
		
		if (!taskName) { new Notice('Task name is empty.'); return; }
		new Notice(`Adding: ${taskName}`);

		// 現在のノート名を取得
		const sourceNote = view.file ? view.file.basename : "";

		try {
			const timeline = await this.getTimeline();
			const res = await this.callRtmApi('rtm.tasks.add', { timeline: timeline, name: taskName, parse: '1' });

			const list = Array.isArray(res.rsp.list) ? res.rsp.list[0] : res.rsp.list;
			const listId = list.id;
			const series = Array.isArray(list.taskseries) ? list.taskseries[0] : list.taskseries;
			const taskSeriesId = series.id;
			const taskObj = Array.isArray(series.task) ? series.task[0] : series.task;
			const taskId = taskObj.id;

			// 現在の設定に従ってデフォルト期日を設定
			if (this.settings.defaultDueForNewTask === 'today') {
				try {
					await this.callRtmApi('rtm.tasks.setDueDate', {
						timeline: timeline,
						list_id: listId,
						taskseries_id: taskSeriesId,
						task_id: taskId,
						due: 'today',
						parse: '1'
					});
				} catch (err) {
					console.error("Failed to set due date", err);
				}
			}

			// RTMのノート（Note）としてObsidianのノート名を追加
			if (sourceNote) {
				try {
					await this.callRtmApi('rtm.tasks.notes.add', {
						timeline: timeline,
						list_id: listId,
						taskseries_id: taskSeriesId,
						task_id: taskId,
						note_title: "Obsidian Link",
						note_text: `From Obsidian Note: [[${sourceNote}]]`
					});
				} catch (noteErr) {
					console.error("Failed to add note to RTM task", noteErr);
				}
			}

			const idTag = `[🐮](rtm:${listId}:${taskSeriesId}:${taskId})`;
			const newLine = `- [ ] ${idTag} ${taskName}`;
			editor.setLine(cursor.line, newLine);
			new Notice('Added to RTM!');
		} catch (e) { console.error("Add Task Error:", e); new Notice('Add error.'); }
	}

	// 6. Complete Task
	async completeTaskInEditor(editor: Editor) {
		const cursor = editor.getCursor();
		const lineText = editor.getLine(cursor.line);
		const regex = /\(rtm:([\w\d]+):([\w\d]+):([\w\d]+)\)/;
		const match = lineText.match(regex);

		if (!match) { new Notice(`Error: No RTM Link found.`); return; }

		const listId = match[1];
		const seriesId = match[2];
		const taskId = match[3];

		if (!listId || listId === 'MISSING') { new Notice('Error: List ID invalid.'); return; }

		new Notice('Completing task...');
		try {
			const timeline = await this.getTimeline();
			await this.callRtmApi('rtm.tasks.complete', {
				timeline: timeline,
				list_id: listId,
				taskseries_id: seriesId,
				task_id: taskId
			});
			const completedLine = lineText.replace('- [ ]', '- [x]');
			editor.setLine(cursor.line, completedLine);
			new Notice('Task completed!');
		} catch (e) { console.error("Completion Error:", e); new Notice('Completion error.'); }
	}

	async getTimeline(): Promise<string> {
		if (this.timeline) return this.timeline;
		const res = await this.callRtmApi('rtm.timelines.create');
		this.timeline = res.rsp.timeline;
		return this.timeline!;
	}

	async callRtmApi(method: string, params: any = {}) {
		const apiKey = this.settings.apiKey;
		const sharedSecret = this.settings.sharedSecret;
		if(!apiKey || !sharedSecret) throw new Error("API Key/Secret missing");

		const apiParams: any = { ...params, method: method, api_key: apiKey, format: 'json', auth_token: this.settings.authToken };
		const keys = Object.keys(apiParams).sort();
		let sigString = sharedSecret;
		for (const key of keys) sigString += key + apiParams[key];
		apiParams['api_sig'] = md5(sigString);

		const url = `${RTM_REST_URL}?${new URLSearchParams(apiParams).toString()}`;
		const res = await requestUrl({ url: url });
		if(res.json.rsp.stat !== 'ok') {
			console.error('API Error:', res.json);
			throw new Error(`API Error: ${res.json.rsp.err?.msg}`);
		}
		return res.json;
	}

	async ensureFolderExists(folderPath: string) {
		if (!folderPath) return;
		const parts = folderPath.split('/');
		let currentPath = '';
		for (const part of parts) {
			if (!part) continue;
			currentPath = currentPath === '' ? part : `${currentPath}/${part}`;
			if (!this.app.vault.getAbstractFileByPath(currentPath)) {
				try {
					await this.app.vault.createFolder(currentPath);
				} catch (e) {
					console.error(`Failed to create folder: ${currentPath}`, e);
				}
			}
		}
	}

	async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
	async saveSettings() { await this.saveData(this.settings); }
}

// --- Import Selection Modal ---
class TaskImportModal extends Modal {
	tasks: FormattedTask[];
	selected: boolean[];
	onSubmit: (selected: FormattedTask[]) => void;

	constructor(app: App, tasks: FormattedTask[], onSubmit: (selected: FormattedTask[]) => void) {
		super(app);
		this.tasks = tasks;
		// デフォルトは選択なし
		this.selected = new Array(tasks.length).fill(false);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: `Select Tasks (${this.tasks.length})` });

		const listContainer = contentEl.createDiv();
		listContainer.style.maxHeight = "400px";
		listContainer.style.overflowY = "auto";
		listContainer.style.marginBottom = "10px";

		this.tasks.forEach((task, index) => {
			const itemDiv = listContainer.createDiv();
			itemDiv.style.display = "flex";
			itemDiv.style.alignItems = "center";
			itemDiv.style.padding = "5px 0";
			itemDiv.style.borderBottom = "1px solid var(--background-modifier-border)";

			const checkbox = itemDiv.createEl("input", { type: "checkbox" });
			checkbox.checked = this.selected[index] ?? false;
			checkbox.onchange = (e) => {
				// @ts-ignore
				this.selected[index] = e.target.checked;
			};

			const label = itemDiv.createSpan();
			label.style.marginLeft = "10px";
			let info = `<b>${task.name}</b>`;
			if(task.listName) info += ` <small style="color:var(--text-muted)">[${task.listName}]</small>`;
			if(task.due) info += ` <small style="color:var(--text-accent)">${task.due}</small>`;
			if(task.notes && task.notes.length > 0) info += ` <small>📝</small>`;
			label.innerHTML = info;
		});

		const btnDiv = contentEl.createDiv();
		btnDiv.style.display = "flex";
		btnDiv.style.justifyContent = "flex-end";
		btnDiv.style.gap = "10px";

		const toggleBtn = btnDiv.createEl("button", { text: "Select All" });
		toggleBtn.onclick = () => {
			const allSelected = this.selected.every(Boolean);
			this.selected.fill(!allSelected);
			const checkboxes = listContainer.querySelectorAll('input[type="checkbox"]');
			checkboxes.forEach((cb: any) => cb.checked = !allSelected);
			// ★修正: .text ではなく .textContent を使用
			toggleBtn.textContent = allSelected ? "Select All" : "Deselect All";
		};

		const importBtn = btnDiv.createEl("button", { text: "Process Selected" });
		importBtn.className = "mod-cta";
		importBtn.onclick = () => {
			const tasksToImport = this.tasks.filter((_, i) => this.selected[i]);
			this.onSubmit(tasksToImport);
			this.close();
		};
	}

	onClose() { this.contentEl.empty(); }
}

// --- Filter Modal ---
class FilterModal extends Modal {
	onSubmit: (result: string) => void;
	constructor(app: App, onSubmit: (result: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}
	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: "Filter RTM Tasks" });
		new Setting(contentEl)
			.setName("Search Query")
			.setDesc("e.g. list:Inbox, due:today")
			.addText((text) =>
				text.setValue("status:incomplete").onChange((value) => {}).inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter") { this.onSubmit(text.getValue()); this.close(); }
				})
			);
		new Setting(contentEl).addButton((btn) => btn.setButtonText("Search").setCta().onClick(() => {
			// @ts-ignore
			const input = contentEl.querySelector('input'); 
			if(input) { this.onSubmit(input.value); this.close(); }
		}));
	}
	onClose() { this.contentEl.empty(); }
}

class RtmSettingTab extends PluginSettingTab {
	plugin: RtmPlugin;
	constructor(app: App, plugin: RtmPlugin) { super(app, plugin); this.plugin = plugin; }
	display(): void {
		const {containerEl} = this; containerEl.empty();
		containerEl.createEl('h2', {text: 'Remember The Milk Settings'});
		
		const buildTime = typeof BUILD_TIME !== 'undefined' ? BUILD_TIME : "Unknown";
		containerEl.createEl('p', {
			text: `Version: ${this.plugin.manifest.version} (Build: ${buildTime})`,
			cls: 'setting-item-description'
		}).style.marginBottom = '2em';

		new Setting(containerEl).setName('API Key').addText(text => text.setValue(this.plugin.settings.apiKey).onChange(async (v) => { this.plugin.settings.apiKey = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Shared Secret').addText(text => text.setValue(this.plugin.settings.sharedSecret).onChange(async (v) => { this.plugin.settings.sharedSecret = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Auth').addButton(b => b.setButtonText('Start Auth').onClick(async () => await this.startAuthProcess()));

		new Setting(containerEl)
			.setName('Default Due Date')
			.setDesc('Setting for new tasks created from editor')
			.addDropdown(drop => drop
				.addOption('none', 'No Due Date')
				.addOption('today', 'Today')
				.setValue(this.plugin.settings.defaultDueForNewTask)
				.onChange(async (v: 'none' | 'today') => {
					this.plugin.settings.defaultDueForNewTask = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Note Creation Folder')
			.setDesc('Folder to create notes from RTM tasks.')
			.addDropdown(drop => {
				drop.addOption('', '/ (Vault Root)');
				const folders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder) as TFolder[];
				folders.forEach(f => {
					if (f.path !== '/') {
						drop.addOption(f.path, f.path);
					}
				});
				drop.setValue(this.plugin.settings.noteCreationFolder);
				drop.onChange(async (v) => {
					this.plugin.settings.noteCreationFolder = v;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Import with Notes and RTM Link')
			.setDesc('When inserting tasks to the editor, also include RTM task notes and links as sub-items.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.importWithNotesAndLink)
				.onChange(async (v) => {
					this.plugin.settings.importWithNotesAndLink = v;
					await this.plugin.saveSettings();
				})
			);
	}
	async startAuthProcess() {
		const rtm = this.plugin;
		const apiKey = rtm.settings.apiKey;
		const sharedSecret = rtm.settings.sharedSecret;
		if (!apiKey || !sharedSecret) { new Notice('Enter keys first'); return; }
		const frobParams:any = { method: 'rtm.auth.getFrob', api_key: apiKey, format: 'json' };
		let sigString = sharedSecret;
		Object.keys(frobParams).sort().forEach(k => sigString += k + frobParams[k]);
		frobParams['api_sig'] = md5(sigString);
		const frobRes = await requestUrl({ url: `${RTM_REST_URL}?${new URLSearchParams(frobParams).toString()}` });
		const frob = frobRes.json.rsp.frob;
		const authParams:any = { api_key: apiKey, perms: 'delete', frob: frob };
		let authSigString = sharedSecret;
		Object.keys(authParams).sort().forEach(k => authSigString += k + authParams[k]);
		const apiSig = md5(authSigString);
		window.open(`${RTM_AUTH_URL}?api_key=${apiKey}&perms=delete&frob=${frob}&api_sig=${apiSig}`);
		new TokenModal(this.app, frob, rtm, async () => { this.display(); }).open();
	}
}

class TokenModal extends Modal {
	frob: string; plugin: RtmPlugin; onSuccess: () => void;
	constructor(app: App, frob: string, plugin: RtmPlugin, onSuccess: () => void) { super(app); this.frob = frob; this.plugin = plugin; this.onSuccess = onSuccess; }
	onOpen() {
		const {contentEl} = this;
		new Setting(contentEl).addButton(btn => btn.setButtonText('Finish Auth').setCta().onClick(async () => {
			const apiKey = this.plugin.settings.apiKey;
			const sharedSecret = this.plugin.settings.sharedSecret;
			const tokenParams:any = { method: 'rtm.auth.getToken', api_key: apiKey, format: 'json', frob: this.frob };
			let sig = sharedSecret;
			Object.keys(tokenParams).sort().forEach(k => sig += k + tokenParams[k]);
			tokenParams['api_sig'] = md5(sig);
			try {
				const res = await requestUrl({ url: `${RTM_REST_URL}?${new URLSearchParams(tokenParams).toString()}` });
				if(res.json.rsp.auth) {
					this.plugin.settings.authToken = res.json.rsp.auth.token;
					await this.plugin.saveSettings();
					new Notice('Success!'); this.onSuccess(); this.close();
				} else { new Notice('Failed.'); }
			} catch (e) { new Notice('Error.'); }
		}));
	}
	onClose() { this.contentEl.empty(); }
}