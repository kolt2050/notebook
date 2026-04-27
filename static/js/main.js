const Main = {
    currentTabIndex: 0,
    deadlineTimer: null,
    editingDeadlineId: null,
    editingDeadlineField: null,
    async init() {
        try {
            if (typeof TurndownService !== 'undefined') {
                this.turndown = new TurndownService({
                    headingStyle: 'atx',
                    codeBlockStyle: 'fenced',
                    blankReplacement: function (content, node) {
                        // For blank nodes (empty divs, br-only divs), return single newline
                        return '\n';
                    }
                });

                // Custom rule: properly handle all <pre> blocks (with or without <code>)
                this.turndown.addRule('fencedCodeBlock', {
                    filter: function (node) {
                        return node.nodeName === 'PRE';
                    },
                    replacement: function (content, node) {
                        const code = node.querySelector('code');
                        // Use textContent to strip all hljs <span> tags
                        let text = code ? code.textContent : node.textContent;
                        // Remove leading/trailing newlines only
                        text = text.replace(/^\n+/, '').replace(/\n+$/, '');
                        // Detect language from <code> class
                        let lang = '';
                        if (code) {
                            const langClass = Array.from(code.classList).find(c => c.startsWith('language-'));
                            lang = langClass ? langClass.replace('language-', '') : '';
                            // Strip "hljs" from lang if present (e.g. "python hljs" → "python")
                            lang = lang.replace(/\s*hljs\s*/, '').trim();
                        }
                        return '\n\n```' + lang + '\n' + text + '\n```\n\n';
                    }
                });

                // Add rule to skip empty bold/italic tags that cause ** on empty lines
                this.turndown.addRule('skipEmptyEmphasis', {
                    filter: ['strong', 'b', 'em', 'i'],
                    replacement: function (content) {
                        return content.trim() ? '**' + content + '**' : content;
                    }
                });

                // Add rule to preserve images with custom dimensions/styles
                this.turndown.addRule('preserveResizedImages', {
                    filter: function (node) {
                        return node.nodeName === 'IMG' && (node.getAttribute('style') || node.getAttribute('width'));
                    },
                    replacement: function (content, node) {
                        return node.outerHTML;
                    }
                });
            } else {
                console.warn('TurndownService not found, Markdown export will be limited.');
            }

            if (typeof marked !== 'undefined') {
                marked.setOptions({
                    headerIds: false,
                    mangle: false,
                    gfm: true,
                    breaks: true
                });
            }
        } catch (e) {
            console.error('Failed to init converters:', e);
        }

        try {
            await Tree.refresh();
        } catch (err) {
            console.error('Failed to load tree:', err);
        }

        // Initialize localization
        I18n.init();

        // Add event listeners
        this.addEventListeners();
        this.initResizer();
        this.refreshStats();

        // Auto-save every 5 minutes
        setInterval(() => {
            console.log('[Auto-save] Periodic trigger');
            Editor.save();
        }, 5 * 60 * 1000);

        await this.loadShortcutTabs();
        await this.loadShortcuts();
        this.showDashboard();
    },

    async getCurrentPage() {
        const pages = await API.getShortcutPages();
        if (this.currentTabIndex >= pages.length) this.currentTabIndex = Math.max(0, pages.length - 1);
        return pages[this.currentTabIndex];
    },

    async saveCurrentPage(pagePatch) {
        const pages = await API.getShortcutPages();
        if (this.currentTabIndex >= pages.length) this.currentTabIndex = Math.max(0, pages.length - 1);
        pages[this.currentTabIndex] = { ...pages[this.currentTabIndex], ...pagePatch };
        await API.saveShortcutPages(pages);
    },

    async getCurrentShortcuts() {
        const page = await this.getCurrentPage();
        if (!page.shortcuts) page.shortcuts = [];
        return page.shortcuts;
    },

    async saveCurrentShortcuts(shortcuts) {
        await this.saveCurrentPage({ type: 'shortcut', shortcuts });
    },

    async getCurrentDeadlineItems() {
        const page = await this.getCurrentPage();
        if (!page.items) page.items = [];
        return page.items;
    },

    async saveCurrentDeadlineItems(items) {
        await this.saveCurrentPage({ type: 'deadline', items: this.sortDeadlinesByDate(items) });
    },

    async loadShortcutTabs() {
        const pages = await API.getShortcutPages();
        const tabsContainer = document.getElementById('shortcut-tabs');
        if (!tabsContainer) return;
        
        tabsContainer.innerHTML = '';
        pages.forEach((page, index) => {
            const tab = document.createElement('div');
            tab.className = `shortcut-tab ${index === this.currentTabIndex ? 'active' : ''}`;
            
            tab.ondblclick = (e) => {
                e.stopPropagation();
                this.renameShortcutTab(index);
            };
            
            tab.onclick = (e) => {
                if (e.target.closest('.tab-close') || e.target.tagName === 'INPUT') return;
                if (this.currentTabIndex === index) return; // Allow double-click by not re-rendering
                this.currentTabIndex = index;
                this.loadShortcutTabs();
                this.loadShortcuts();
            };
            
            const typeIcon = document.createElement('span');
            typeIcon.className = 'tab-type-icon';
            typeIcon.textContent = page.type === 'deadline' ? '⏰' : '🔗';
            tab.appendChild(typeIcon);

            const titleSpan = document.createElement('span');
            titleSpan.className = 'tab-title';
            titleSpan.textContent = page.title || `Лист ${index + 1}`;
            tab.appendChild(titleSpan);
            
            if (pages.length > 1) {
                const closeBtn = document.createElement('span');
                closeBtn.className = 'tab-close';
                closeBtn.textContent = '×';
                closeBtn.onclick = (e) => {
                    e.stopPropagation();
                    this.deleteShortcutTab(index);
                };
                tab.appendChild(closeBtn);
            }
            
            tabsContainer.appendChild(tab);
        });
    },

    async addShortcutTab() {
        const existingMenu = document.querySelector('.tab-create-menu');
        if (existingMenu) {
            existingMenu.remove();
            return;
        }

        const addBtn = document.getElementById('add-shortcut-tab-btn');
        if (!addBtn) return;

        const menu = document.createElement('div');
        menu.className = 'tab-context-menu tab-create-menu';
        menu.innerHTML = `
            <div class="tab-context-menu-item" data-tab-type="shortcut">
                <span class="tab-create-menu-icon">Link</span>
                <span>Links</span>
            </div>
            <div class="tab-context-menu-item" data-tab-type="deadline">
                <span class="tab-create-menu-icon">Due</span>
                <span>Deadlines</span>
            </div>
        `;

        const rect = addBtn.getBoundingClientRect();
        menu.style.top = `${rect.bottom + 6}px`;
        menu.style.left = `${Math.max(8, rect.right - 170)}px`;
        document.body.appendChild(menu);

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', onOutsideClick);
            document.removeEventListener('keydown', onKeydown);
        };

        const onOutsideClick = (e) => {
            if (!menu.contains(e.target) && e.target !== addBtn) closeMenu();
        };

        const onKeydown = (e) => {
            if (e.key === 'Escape') closeMenu();
        };

        menu.querySelectorAll('[data-tab-type]').forEach(item => {
            item.onclick = async () => {
                const type = item.dataset.tabType;
                closeMenu();
                await this.createShortcutTab(type);
            };
        });

        setTimeout(() => {
            document.addEventListener('click', onOutsideClick);
            document.addEventListener('keydown', onKeydown);
        }, 0);
    },

    async createShortcutTab(type = 'shortcut') {
        const pages = await API.getShortcutPages();
        const newId = 'page_' + Date.now();
        const pageNumber = pages.length + 1;
        const newPage = type === 'deadline'
            ? { id: newId, title: `Deadlines ${pageNumber}`, type: 'deadline', items: [] }
            : { id: newId, title: `Лист ${pageNumber}`, type: 'shortcut', shortcuts: [] };

        pages.push(newPage);
        await API.saveShortcutPages(pages);
        this.currentTabIndex = pages.length - 1;
        await this.loadShortcutTabs();
        await this.loadShortcuts();
    },

    async deleteShortcutTab(index) {
        Modals.showConfirm('Delete Tab', 'Are you sure you want to delete this tab and all its content?', async () => {
            const pages = await API.getShortcutPages();
            if (pages.length <= 1) return;
            pages.splice(index, 1);
            await API.saveShortcutPages(pages);
            if (this.currentTabIndex >= pages.length) {
                this.currentTabIndex = Math.max(0, pages.length - 1);
            }
            await this.loadShortcutTabs();
            await this.loadShortcuts();
        }, 'danger');
    },

    async renameShortcutTab(index) {
        const tabsContainer = document.getElementById('shortcut-tabs');
        const tabEl = tabsContainer.children[index];
        const titleSpan = tabEl.querySelector('.tab-title');
        const currentTitle = titleSpan.textContent;
        
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'shortcut-tab-rename';
        input.value = currentTitle;
        
        titleSpan.style.display = 'none';
        tabEl.insertBefore(input, titleSpan);
        input.focus();
        input.select();
        
        const finishRename = async () => {
            const newTitle = input.value.trim();
            if (newTitle && newTitle !== currentTitle) {
                const pages = await API.getShortcutPages();
                pages[index].title = newTitle;
                await API.saveShortcutPages(pages);
            }
            await this.loadShortcutTabs();
        };
        
        input.onblur = finishRename;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') finishRename();
            if (e.key === 'Escape') this.loadShortcutTabs();
        };
    },

    findEmptySlot(shortcuts) {
        const GRID_W = 160;
        const GRID_H = 140;
        const occupied = new Set();
        for (const s of shortcuts) {
            if (s.x !== undefined && s.y !== undefined) {
                occupied.add(`${s.x},${s.y}`);
            }
        }
        for (let y = 0; y < 20; y++) {
            for (let x = 0; x < 10; x++) {
                const px = x * GRID_W;
                const py = y * GRID_H;
                if (!occupied.has(`${px},${py}`)) {
                    return { x: px, y: py };
                }
            }
        }
        return { x: 0, y: 0 };
    },

    async loadShortcuts() {
        const page = await this.getCurrentPage();
        if (page && page.type === 'deadline') {
            return this.loadDeadlines();
        }

        this.stopDeadlineTimer();
        const shortcuts = await this.getCurrentShortcuts();
        return this.loadShortcutGrid(shortcuts);
    },

    async loadShortcutGrid(shortcuts) {
        const container = document.getElementById('shortcuts-container');
        if (!container) return;

        container.innerHTML = '';
        container.classList.remove('deadline-list');
        container.classList.add('shortcut-cards');

        const GRID_W = 160;
        const GRID_H = 140;

        let needsSave = false;

        shortcuts.forEach((s, index) => {
            const card = document.createElement('div');
            card.className = 'shortcut-card';
            card.draggable = true;

            if (s.x === undefined || s.y === undefined) {
                const slot = this.findEmptySlot(shortcuts);
                s.x = slot.x;
                s.y = slot.y;
                needsSave = true;
            }

            card.style.left = s.x + 'px';
            card.style.top = s.y + 'px';

            let targetUrl = s.url.trim();
            // Remove wrapping quotes if the user pasted them
            if ((targetUrl.startsWith('"') && targetUrl.endsWith('"')) || (targetUrl.startsWith("'") && targetUrl.endsWith("'"))) {
                targetUrl = targetUrl.slice(1, -1);
            }

            if (/^[a-zA-Z]:[\\/]/.test(targetUrl)) {
                targetUrl = 'file:///' + targetUrl.replace(/\\/g, '/');
            } else if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://') && !targetUrl.startsWith('file://')) {
                targetUrl = 'https://' + targetUrl;
            }

            if (s.bgColor) {
                card.style.backgroundColor = s.bgColor;
            }

            let iconHtml = s.icon || '🔗';
            if (iconHtml.startsWith('http://') || iconHtml.startsWith('https://')) {
                iconHtml = `<img src="${iconHtml}" style="width: 1em; height: 1em; object-fit: contain; border-radius: 4px;">`;
            }

            card.innerHTML = `
                <div class="shortcut-actions-overlay">
                    <button class="shortcut-action-btn edit-btn" title="Edit">✏️</button>
                    <button class="shortcut-action-btn delete-btn" title="Delete">🗑️</button>
                </div>
                <div class="shortcut-icon" style="display: flex; align-items: center; justify-content: center;">${iconHtml}</div>
                <div class="shortcut-title">${s.title}</div>
            `;

            card.addEventListener('dragstart', (e) => {
                this.draggedShortcutIndex = index;
                e.dataTransfer.effectAllowed = 'move';
                
                const rect = card.getBoundingClientRect();
                this.dragOffsetX = e.clientX - rect.left;
                this.dragOffsetY = e.clientY - rect.top;
                
                if (e.dataTransfer.setData) {
                    e.dataTransfer.setData('text/plain', '');
                }

                setTimeout(() => card.style.opacity = '0.5', 0);
            });

            card.addEventListener('dragend', () => {
                card.style.opacity = '1';
                document.querySelectorAll('.shortcut-card').forEach(c => c.style.transform = '');
            });

            card.onclick = (e) => {
                if (e.target.closest('.shortcut-actions-overlay')) return;

                if (targetUrl.startsWith('file:///')) {
                    if (chrome && chrome.tabs && chrome.tabs.create) {
                        chrome.tabs.create({ url: targetUrl });
                    } else {
                        window.open(targetUrl, '_blank');
                    }
                } else {
                    window.open(targetUrl, '_blank');
                }
            };

            const editBtn = card.querySelector('.edit-btn');
            editBtn.onclick = (e) => { e.stopPropagation(); this.editShortcut(s.id); };

            const deleteBtn = card.querySelector('.delete-btn');
            deleteBtn.onclick = (e) => { e.stopPropagation(); this.deleteShortcut(s.id); };

            container.appendChild(card);
        });

        const addBtn = document.createElement('div');
        addBtn.className = 'shortcut-card add-shortcut';
        addBtn.textContent = '+ Add';
        addBtn.onclick = () => this.addShortcut();

        const addSlot = this.findEmptySlot(shortcuts);
        addBtn.style.left = addSlot.x + 'px';
        addBtn.style.top = addSlot.y + 'px';

        container.appendChild(addBtn);

        container.ondragover = (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        };

        container.ondrop = async (e) => {
            e.preventDefault();
            if (this.draggedShortcutIndex === undefined || this.draggedShortcutIndex === -1) return;

            const containerRect = container.getBoundingClientRect();
            let newX = e.clientX - containerRect.left + container.scrollLeft - (this.dragOffsetX || 0);
            let newY = e.clientY - containerRect.top + container.scrollTop - (this.dragOffsetY || 0);

            newX = Math.round(newX / GRID_W) * GRID_W;
            newY = Math.round(newY / GRID_H) * GRID_H;

            newX = Math.max(0, newX);
            newY = Math.max(0, newY);

            const currentShortcuts = await this.getCurrentShortcuts();
            
            const targetIndex = currentShortcuts.findIndex(s => s.x === newX && s.y === newY);
            if (targetIndex !== -1 && targetIndex !== this.draggedShortcutIndex) {
                const tempX = currentShortcuts[this.draggedShortcutIndex].x;
                const tempY = currentShortcuts[this.draggedShortcutIndex].y;
                currentShortcuts[this.draggedShortcutIndex].x = newX;
                currentShortcuts[this.draggedShortcutIndex].y = newY;
                currentShortcuts[targetIndex].x = tempX;
                currentShortcuts[targetIndex].y = tempY;
            } else {
                currentShortcuts[this.draggedShortcutIndex].x = newX;
                currentShortcuts[this.draggedShortcutIndex].y = newY;
            }

            this.draggedShortcutIndex = -1;

            await this.saveCurrentShortcuts(currentShortcuts);
            await this.loadShortcuts();
        };

        if (needsSave) {
            await this.saveCurrentShortcuts(shortcuts);
        }
    },

    sortDeadlinesByDate(items) {
        return [...items].sort((a, b) => {
            const aTime = new Date(a.deadline).getTime();
            const bTime = new Date(b.deadline).getTime();
            const safeA = Number.isNaN(aTime) ? Infinity : aTime;
            const safeB = Number.isNaN(bTime) ? Infinity : bTime;
            return safeA - safeB;
        });
    },

    formatTimeRemaining(deadlineDate) {
        const deadline = new Date(deadlineDate);
        const time = deadline.getTime();
        if (Number.isNaN(time)) return 'No date';

        const diff = time - Date.now();
        if (diff < 0) return 'Просрочено';
        if (diff < 24 * 60 * 60 * 1000) return 'Сегодня';

        const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
        return `${days} дн.`;
    },

    getDeadlineProgress(deadlineDate) {
        const deadline = new Date(deadlineDate);
        const time = deadline.getTime();
        if (Number.isNaN(time)) return 100;

        const diff = time - Date.now();
        if (diff < 0) return 100;

        const days = Math.ceil(diff / (24 * 60 * 60 * 1000));
        return Math.max(8, Math.min(100, (days / 30) * 100));
    },

    getDeadlineState(deadlineDate) {
        const time = new Date(deadlineDate).getTime();
        if (Number.isNaN(time)) return { color: 'red', overdue: false };

        const diff = time - Date.now();
        const twoDays = 2 * 24 * 60 * 60 * 1000;
        return {
            color: diff > twoDays ? 'green' : 'red',
            overdue: diff < 0
        };
    },

    toDateTimeLocalValue(dateString) {
        const date = new Date(dateString);
        if (Number.isNaN(date.getTime())) return '';
        const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return localDate.toISOString().slice(0, 16);
    },

    async loadDeadlines() {
        const container = document.getElementById('shortcuts-container');
        if (!container) return;

        let items = this.sortDeadlinesByDate(await this.getCurrentDeadlineItems());
        container.innerHTML = '';
        container.classList.remove('shortcut-cards');
        container.classList.add('deadline-list');
        container.ondragover = null;
        container.ondrop = null;
        this.draggedShortcutIndex = -1;

        if (!items.length) {
            const empty = document.createElement('div');
            empty.className = 'deadline-empty';
            empty.textContent = 'No deadlines yet';
            container.appendChild(empty);
        }

        items.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'deadline-item';
            row.dataset.deadlineId = item.id;

            const typeWrap = document.createElement('div');
            typeWrap.className = 'deadline-type-wrap';

            if (this.editingDeadlineId === item.id && this.editingDeadlineField === 'type') {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'deadline-type-input';
                input.value = item.type || '';
                input.placeholder = 'Тип';

                let isSavingType = false;
                const finishEdit = async () => {
                    if (isSavingType) return;
                    isSavingType = true;
                    const nextItems = await this.getCurrentDeadlineItems();
                    const target = nextItems.find(d => d.id === item.id);
                    if (target) target.type = input.value.trim();
                    this.editingDeadlineId = null;
                    this.editingDeadlineField = null;
                    await this.saveCurrentDeadlineItems(nextItems);
                    await this.loadDeadlines();
                };

                input.onblur = finishEdit;
                input.onkeydown = (e) => {
                    if (e.key === 'Enter') finishEdit();
                    if (e.key === 'Escape') {
                        isSavingType = true;
                        this.editingDeadlineId = null;
                        this.editingDeadlineField = null;
                        this.loadDeadlines();
                    }
                };
                typeWrap.appendChild(input);
                setTimeout(() => {
                    input.focus();
                    input.select();
                }, 0);
            } else {
                const type = document.createElement('button');
                type.type = 'button';
                type.className = 'deadline-type';
                type.textContent = item.type || 'Тип';
                type.onclick = () => this.editDeadlineType(item.id);
                typeWrap.appendChild(type);
            }

            const textWrap = document.createElement('div');
            textWrap.className = 'deadline-text-wrap';

            if (this.editingDeadlineId === item.id && this.editingDeadlineField === 'text') {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'deadline-text-input';
                input.value = item.text || '';
                input.placeholder = 'Описание задачи';

                let isSavingText = false;
                const finishEdit = async () => {
                    if (isSavingText) return;
                    isSavingText = true;
                    const nextItems = await this.getCurrentDeadlineItems();
                    const target = nextItems.find(d => d.id === item.id);
                    if (target) target.text = input.value.trim();
                    this.editingDeadlineId = null;
                    this.editingDeadlineField = null;
                    await this.saveCurrentDeadlineItems(nextItems);
                    await this.loadDeadlines();
                };

                input.onblur = finishEdit;
                input.onkeydown = (e) => {
                    if (e.key === 'Enter') finishEdit();
                    if (e.key === 'Escape') {
                        isSavingText = true;
                        this.editingDeadlineId = null;
                        this.editingDeadlineField = null;
                        this.loadDeadlines();
                    }
                };
                textWrap.appendChild(input);
                setTimeout(() => {
                    input.focus();
                    input.select();
                }, 0);
            } else {
                const text = document.createElement('button');
                text.type = 'button';
                text.className = 'deadline-text';
                text.textContent = item.text || 'Без описания';
                text.onclick = () => this.editDeadlineText(item.id);
                textWrap.appendChild(text);
            }

            const barContainer = document.createElement('div');
            barContainer.className = 'deadline-bar-container';
            barContainer.tabIndex = 0;
            barContainer.role = 'button';
            barContainer.title = 'Change deadline';
            barContainer.onclick = () => this.editDeadlineDate(item.id);
            barContainer.onkeydown = (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.editDeadlineDate(item.id);
                }
            };

            const state = this.getDeadlineState(item.deadline);
            const bar = document.createElement('span');
            bar.className = `deadline-bar ${state.color}${state.overdue ? ' overdue' : ''}`;
            bar.style.width = `${this.getDeadlineProgress(item.deadline)}%`;

            const label = document.createElement('span');
            label.className = 'deadline-bar-label';
            label.textContent = this.formatTimeRemaining(item.deadline);

            barContainer.appendChild(bar);
            barContainer.appendChild(label);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'deadline-delete-btn';
            deleteBtn.title = 'Delete deadline';
            deleteBtn.textContent = '🗑️';
            deleteBtn.onclick = () => this.deleteDeadlineItem(item.id);

            row.appendChild(typeWrap);
            row.appendChild(textWrap);
            row.appendChild(barContainer);
            row.appendChild(deleteBtn);
            container.appendChild(row);
        });

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'deadline-add-btn';
        addBtn.textContent = '+ Добавить дедлайн';
        addBtn.onclick = () => this.addDeadlineItem();
        container.appendChild(addBtn);

        this.startDeadlineTimer();
    },

    async addDeadlineItem() {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);

        const item = {
            id: 'dl_' + Date.now(),
            type: '',
            text: '',
            deadline: tomorrow.toISOString()
        };

        const items = await this.getCurrentDeadlineItems();
        items.push(item);
        this.editingDeadlineId = item.id;
        this.editingDeadlineField = 'type';
        await this.saveCurrentDeadlineItems(items);
        await this.loadDeadlines();
    },

    editDeadlineType(id) {
        this.editingDeadlineId = id;
        this.editingDeadlineField = 'type';
        this.loadDeadlines();
    },

    editDeadlineText(id) {
        this.editingDeadlineId = id;
        this.editingDeadlineField = 'text';
        this.loadDeadlines();
    },

    async editDeadlineDate(id) {
        const container = document.getElementById('shortcuts-container');
        const items = await this.getCurrentDeadlineItems();
        const item = items.find(d => d.id === id);
        if (!container || !item) return;

        const row = Array.from(container.querySelectorAll('.deadline-item')).find(el => el.dataset.deadlineId === id);
        const targetBar = row ? row.querySelector('.deadline-bar-container') : null;

        if (!targetBar) return;

        targetBar.innerHTML = '';
        targetBar.classList.add('editing');
        const input = document.createElement('input');
        input.type = 'datetime-local';
        input.className = 'deadline-date-input';
        input.value = this.toDateTimeLocalValue(item.deadline);
        targetBar.appendChild(input);

        let isSavingDate = false;
        const finishEdit = async () => {
            if (isSavingDate) return;
            isSavingDate = true;
            if (input.value) {
                const nextItems = await this.getCurrentDeadlineItems();
                const target = nextItems.find(d => d.id === id);
                if (target) target.deadline = new Date(input.value).toISOString();
                await this.saveCurrentDeadlineItems(nextItems);
            }
            await this.loadDeadlines();
        };

        input.onclick = (e) => e.stopPropagation();
        input.onblur = finishEdit;
        input.onkeydown = (e) => {
            if (e.key === 'Enter') finishEdit();
            if (e.key === 'Escape') {
                isSavingDate = true;
                this.loadDeadlines();
            }
        };
        setTimeout(() => {
            input.focus();
            if (input.showPicker) input.showPicker();
        }, 0);
    },

    async deleteDeadlineItem(id) {
        const items = await this.getCurrentDeadlineItems();
        await this.saveCurrentDeadlineItems(items.filter(item => item.id !== id));
        await this.loadDeadlines();
    },

    startDeadlineTimer() {
        this.stopDeadlineTimer();
        this.deadlineTimer = setInterval(async () => {
            const page = await this.getCurrentPage();
            const activeElement = document.activeElement;
            const isEditing = activeElement && activeElement.closest && activeElement.closest('.deadline-item');
            if (page && page.type === 'deadline' && !isEditing) {
                await this.loadDeadlines();
            }
        }, 60 * 60 * 1000);
    },

    stopDeadlineTimer() {
        if (this.deadlineTimer) {
            clearInterval(this.deadlineTimer);
            this.deadlineTimer = null;
        }
    },

    getIconSelectionHTML(selectedIcon = '🌐') {
        const icons = [
            '🌐', '📁', '📄', '⚙️', '💻', '📱', '🎵', '🎮', '📚', '✉️', '📅', '📊', '🔍', '🎨', '🔐', '🛠️', '☁️', '🌟', '💡', '🏠', '🚀', '🤖', '💰', '🛒',
            '🎬', '📷', '🎤', '🍕', '☕', '🍺', '🏋️', '🚵', '🌍', '📍', '⏰', '🔋', '📡', '💾', '🔑', '📝', '📌', '📈', '📉', '📎', '🔗', '📂', '📆', '📫',
            '📦', '🔔', '🔥', '💧', '⚡', '🌈', '🍎', '🍔', '🍦', '⚽', '🎾', '🎸', '🕹️', '📟', '📠', '📺', '📻', '🧭', '🔭', '🔬', '🧺', '🧼', '🧸'
        ];
        let html = '<div style="font-size: 0.9em; margin-top: 5px; color: var(--text-dim);">Select Icon:</div>';
        html += '<div class="icon-grid" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; justify-content: flex-start; max-height: 180px; overflow-y: auto; padding-right: 5px;">';

        const isUrlIcon = selectedIcon && selectedIcon.startsWith('http');
        if (isUrlIcon) {
            html += `<div class="icon-option selected" data-icon="${selectedIcon}" style="font-size: 1.6rem; cursor: pointer; padding: 4px; border-radius: 6px; transition: all 0.2s; border: 2px solid var(--accent-color); background: rgba(88,166,255,0.1); display: flex; align-items: center; justify-content: center;"><img src="${selectedIcon}" style="width: 1em; height: 1em; border-radius: 4px; object-fit: contain;"></div>`;
        }

        icons.forEach(icon => {
            const isSelected = (!isUrlIcon && icon === selectedIcon) ? 'selected' : '';
            const borderStyle = isSelected ? 'border: 2px solid var(--accent-color); background: rgba(88,166,255,0.1);' : 'border: 2px solid transparent;';
            html += `<div class="icon-option ${isSelected}" data-icon="${icon}" style="font-size: 1.6rem; cursor: pointer; padding: 4px; border-radius: 6px; transition: all 0.2s; display: flex; align-items: center; justify-content: center; ${borderStyle}">${icon}</div>`;
        });
        html += '</div>';
        return html;
    },

    setupIconSelection() {
        const iconInput = document.getElementById('shortcut-icon');
        const options = document.querySelectorAll('#modal-body .icon-option');
        options.forEach(opt => {
            opt.onmouseenter = () => { if (!opt.classList.contains('selected')) opt.style.background = 'var(--border-color)'; };
            opt.onmouseleave = () => { if (!opt.classList.contains('selected')) opt.style.background = 'transparent'; };
            opt.onclick = () => {
                options.forEach(o => {
                    o.classList.remove('selected');
                    o.style.border = '2px solid transparent';
                    o.style.background = 'transparent';
                });
                opt.classList.add('selected');
                opt.style.border = '2px solid var(--accent-color)';
                opt.style.background = 'rgba(88,166,255,0.1)';
                iconInput.value = opt.dataset.icon;
            };
        });

        const urlInput = document.getElementById('shortcut-url');
        if (urlInput) {
            urlInput.addEventListener('blur', () => {
                const url = urlInput.value.trim();
                if ((iconInput.value === '🌐' || iconInput.value.startsWith('http')) && url && !url.startsWith('file://') && !/^[a-zA-Z]:[\\/]/.test(url)) {
                    try {
                        let parsedUrl = url;
                        if (!parsedUrl.startsWith('http')) {
                            parsedUrl = 'https://' + parsedUrl;
                        }
                        const urlObj = new URL(parsedUrl);
                        const faviconUrl = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=128`;

                        let targetOpt = document.querySelector(`.icon-option[data-icon="${iconInput.value}"]`);
                        if (!targetOpt) targetOpt = document.querySelector('.icon-option[data-icon="🌐"]');

                        if (targetOpt) {
                            targetOpt.innerHTML = `<img src="${faviconUrl}" style="width: 1em; height: 1em; border-radius: 4px; object-fit: contain;">`;
                            targetOpt.dataset.icon = faviconUrl;
                            iconInput.value = faviconUrl;

                            options.forEach(o => {
                                o.classList.remove('selected');
                                o.style.border = '2px solid transparent';
                                o.style.background = 'transparent';
                            });
                            targetOpt.classList.add('selected');
                            targetOpt.style.border = '2px solid var(--accent-color)';
                            targetOpt.style.background = 'rgba(88,166,255,0.1)';
                        }
                    } catch (e) { }
                }
            });
        }
    },

    async addShortcut() {
        const bodyHtml = `
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <input type="text" id="shortcut-title" placeholder="Name">
                <input type="text" id="shortcut-url" placeholder="URL (http/https or C:/...)">
                <select id="shortcut-bookmark-select" style="display: none; padding: 8px; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-color); color: var(--text-color);">
                    <option value="">-- Choose from browser bookmarks --</option>
                </select>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <label for="shortcut-color" style="color: var(--text-dim); font-size: 0.9em;">Background Color:</label>
                    <input type="color" id="shortcut-color" value="#0d1117" style="background: none; border: none; padding: 0; width: 30px; height: 30px; cursor: pointer;">
                </div>
                <input type="hidden" id="shortcut-icon" value="🌐">
                ${this.getIconSelectionHTML('🌐')}
            </div>
        `;
        Modals.show('Add Shortcut', bodyHtml, async () => {
            const title = document.getElementById('shortcut-title').value.trim();
            const url = document.getElementById('shortcut-url').value.trim();
            let icon = document.getElementById('shortcut-icon').value.trim() || '🌐';
            const bgColor = document.getElementById('shortcut-color').value;

            if (!title || !url) return;

            if (icon === '🌐' && url && !url.startsWith('file://') && !/^[a-zA-Z]:[\\/]/.test(url)) {
                try {
                    let parsedUrl = url;
                    if (!parsedUrl.startsWith('http')) {
                        parsedUrl = 'https://' + parsedUrl;
                    }
                    const urlObj = new URL(parsedUrl);
                    icon = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=128`;
                } catch (e) { }
            }

            const shortcuts = await this.getCurrentShortcuts();
            shortcuts.push({ id: Date.now().toString(), title, url, icon, bgColor });
            await this.saveCurrentShortcuts(shortcuts);
            await this.loadShortcuts();
        });
        this.setupIconSelection();
        this.loadBrowserBookmarks();
    },

    loadBrowserBookmarks() {
        const select = document.getElementById('shortcut-bookmark-select');
        if (!select || !window.chrome || !chrome.bookmarks) return;

        chrome.bookmarks.getTree((bookmarkTreeNodes) => {
            const bookmarksList = [];

            const traverseBookmarks = (nodes, path) => {
                for (const node of nodes) {
                    if (node.url) {
                        bookmarksList.push({ title: node.title || node.url, url: node.url, path: path });
                    }
                    if (node.children) {
                        const newPath = path ? `${path} > ${node.title}` : node.title;
                        traverseBookmarks(node.children, newPath);
                    }
                }
            };

            traverseBookmarks(bookmarkTreeNodes, '');

            if (bookmarksList.length > 0) {
                select.style.display = 'block';
                bookmarksList.forEach(b => {
                    const option = document.createElement('option');
                    option.value = b.url;
                    option.textContent = b.path ? `${b.path} > ${b.title}` : b.title;
                    option.dataset.title = b.title;
                    select.appendChild(option);
                });

                select.addEventListener('change', (e) => {
                    const url = e.target.value;
                    if (url) {
                        const urlInput = document.getElementById('shortcut-url');
                        urlInput.value = url;
                        const selectedOption = select.options[select.selectedIndex];
                        if (selectedOption) {
                            document.getElementById('shortcut-title').value = selectedOption.dataset.title;
                        }
                        urlInput.dispatchEvent(new Event('blur'));
                    }
                });
            }
        });
    },

    async editShortcut(id) {
        const shortcuts = await this.getCurrentShortcuts();
        const shortcut = shortcuts.find(s => s.id === id);
        if (!shortcut) return;

        const bodyHtml = `
            <div style="display: flex; flex-direction: column; gap: 10px;">
                <input type="text" id="shortcut-title" value="${shortcut.title.replace(/"/g, '&quot;')}">
                <input type="text" id="shortcut-url" value="${shortcut.url.replace(/"/g, '&quot;')}">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <label for="shortcut-color" style="color: var(--text-dim); font-size: 0.9em;">Background Color:</label>
                    <input type="color" id="shortcut-color" value="${shortcut.bgColor || '#0d1117'}" style="background: none; border: none; padding: 0; width: 30px; height: 30px; cursor: pointer;">
                </div>
                <input type="hidden" id="shortcut-icon" value="${shortcut.icon.replace(/"/g, '&quot;')}">
                ${this.getIconSelectionHTML(shortcut.icon)}
            </div>
        `;
        Modals.show('Edit Shortcut', bodyHtml, async () => {
            shortcut.title = document.getElementById('shortcut-title').value.trim();
            shortcut.url = document.getElementById('shortcut-url').value.trim();
            shortcut.icon = document.getElementById('shortcut-icon').value.trim() || '🌐';
            shortcut.bgColor = document.getElementById('shortcut-color').value;

            if (shortcut.icon === '🌐' && shortcut.url && !shortcut.url.startsWith('file://') && !/^[a-zA-Z]:[\\/]/.test(shortcut.url)) {
                try {
                    let parsedUrl = shortcut.url;
                    if (!parsedUrl.startsWith('http')) {
                        parsedUrl = 'https://' + parsedUrl;
                    }
                    const urlObj = new URL(parsedUrl);
                    shortcut.icon = `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=128`;
                } catch (e) { }
            }

            if (!shortcut.title || !shortcut.url) return;
            await this.saveCurrentShortcuts(shortcuts);
            await this.loadShortcuts();
        });
        this.setupIconSelection();
    },

    async deleteShortcut(id) {
        Modals.showConfirm('Delete Shortcut', 'Are you sure you want to delete this shortcut?', async () => {
            let shortcuts = await this.getCurrentShortcuts();
            shortcuts = shortcuts.filter(s => s.id !== id);
            await this.saveCurrentShortcuts(shortcuts);
            await this.loadShortcuts();
        }, 'danger');
    },

    showDashboard() {
        document.getElementById('welcome-view').style.display = 'flex';
        document.getElementById('editor-view').style.display = 'none';
        Tree.deselect();
    },

    hideDashboard() {
        document.getElementById('welcome-view').style.display = 'none';
        document.getElementById('editor-view').style.display = 'flex';
    },

    initResizer() {
        const sidebar = document.querySelector('.sidebar');
        const resizer = document.getElementById('resizer');
        const appContainer = document.querySelector('.app-container');

        // Load saved width
        const savedWidth = localStorage.getItem('sidebarWidth');
        if (savedWidth) {
            sidebar.style.width = savedWidth + 'px';
        }

        let isResizing = false;

        resizer.addEventListener('mousedown', (e) => {
            isResizing = true;
            document.body.classList.add('resizing-active');
            resizer.classList.add('active');
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            let newWidth = e.clientX;

            // Constrain width
            if (newWidth < 200) newWidth = 200;
            if (newWidth > 600) newWidth = 600;

            sidebar.style.width = newWidth + 'px';
            localStorage.setItem('sidebarWidth', newWidth);
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.classList.remove('resizing-active');
                resizer.classList.remove('active');
            }
        });
    },

    addEventListeners() {
        const homeBtn = document.getElementById('home-btn');
        if (homeBtn) homeBtn.onclick = () => this.showDashboard();

        const addTabBtn = document.getElementById('add-shortcut-tab-btn');
        if (addTabBtn) addTabBtn.onclick = () => this.addShortcutTab();

        const welcomeAddBtn = document.getElementById('welcome-add-btn');
        if (welcomeAddBtn) welcomeAddBtn.onclick = () => this.addNew();

        const welcomeExportShortcutsBtn = document.getElementById('welcome-export-shortcuts-btn');
        if (welcomeExportShortcutsBtn) welcomeExportShortcutsBtn.onclick = () => this.exportShortcuts();

        const welcomeImportShortcutsBtn = document.getElementById('welcome-import-shortcuts-btn');
        if (welcomeImportShortcutsBtn) welcomeImportShortcutsBtn.onclick = () => this.importShortcuts();

        document.getElementById('lang-toggle-btn').onclick = () => I18n.toggle();
        document.getElementById('add-doc-btn').onclick = () => this.addNew();

        // Search with debounce
        const searchInput = document.getElementById('search-input');
        const searchClear = document.getElementById('search-clear');
        let searchTimeout;

        const updateClearVisibility = () => {
            searchClear.style.display = searchInput.value ? 'block' : 'none';
        };

        searchInput.oninput = () => {
            updateClearVisibility();
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.handleSearch(searchInput.value), 300);
        };

        searchClear.onclick = () => {
            searchInput.value = '';
            updateClearVisibility();
            this.handleSearch('');
            searchInput.focus();
        };

        // Auto-save on blur
        Editor.titleInput.onblur = () => Editor.save();
        Editor.contentArea.onblur = () => Editor.save();

        // Export/Import stubs for now
        document.getElementById('export-doc-btn').onclick = () => this.exportCurrent();
        document.getElementById('export-all-btn').onclick = () => this.exportAll();
        document.getElementById('backup-db-btn').onclick = () => this.backupDb();
        document.getElementById('import-db-btn').onclick = () => this.importDb();

        const resetBtn = document.getElementById('reset-btn');
        if (resetBtn) {
            resetBtn.onclick = () => {
                Modals.show(
                    I18n.get('confirm_reset_title'),
                    I18n.get('confirm_reset_text'),
                    async () => {
                        await API.deleteAllDocuments();
                        Editor.clear();
                        await Tree.refresh();
                    },
                    'danger'
                );
            };
        }
    },

    async addNew(parentId = null) {
        try {
            const newItem = await API.createDocument({
                title: I18n.get('new_doc_title'),
                is_folder: 0,
                parent_id: parentId
            });
            await Tree.refresh();
            await Tree.selectItem(newItem);
            this.hideDashboard();

            // Focus title and select text for quick renaming
            Editor.titleInput.focus();
            Editor.titleInput.select();
        } catch (err) {
            console.error('Failed to create document:', err);
        }
    },

    async exportCurrent() {
        if (!Editor.currentDoc) {
            Modals.showInfo(I18n.get('notice_title'), I18n.get('select_first'));
            return;
        }
        if (!this.turndown) {
            Modals.showInfo(I18n.get('error_title'), I18n.get('converter_error'));
            return;
        }
        // Pre-process HTML: normalize div structure for proper line breaks
        // Editor wraps each line in <div>, TurndownService treats <div> as paragraph (double newline)
        let html = Editor.contentArea.innerHTML;
        // Replace empty divs (blank line indicators in editor) with <br><br> (paragraph break)
        html = html.replace(/<div>\s*(?:<br\s*\/?>)?\s*<\/div>/gi, '<br><br>');
        // Replace </div><div> boundaries between content divs with <br> (line break)
        html = html.replace(/<\/div>\s*<div(?:\s[^>]*)?>/gi, '<br>');
        // Strip remaining opening/closing div tags
        html = html.replace(/<\/?div(?:\s[^>]*)?>/gi, '');

        let md = this.turndown.turndown(html);

        // Post-processing: clean up extra whitespace
        // Remove lines that are just ** or __ (empty bold/italic artifacts)
        md = md.replace(/^\s*(\*\*|__)\s*$/gm, '');
        // Clean whitespace-only lines (from <div><br></div> etc.)
        md = md.replace(/^\s+$/gm, '');
        // Collapse 3+ consecutive newlines into 2 (max one blank line)
        md = md.replace(/\n{3,}/g, '\n\n');
        // Unescape markdown special chars that TurndownService over-escapes
        md = md.replace(/^\\-/gm, '-');
        md = md.replace(/^(\s*)\\(\d+)\./gm, '$1$2.');
        // Unescape \. after digits anywhere (e.g. "1\." → "1.")
        md = md.replace(/(\d)\\\./g, '$1.');
        // Unescape underscores (e.g. "name\_suffix" → "name_suffix")
        md = md.replace(/\\_/g, '_');
        // Trim leading/trailing whitespace
        md = md.trim();

        const fileName = `${Editor.currentDoc.title}.md`;
        this.downloadFile(fileName, md);
    },

    async exportAll() {
        try {
            const md = await API.exportAllMarkdown();
            this.downloadFile('notebook_export.md', md);
        } catch (err) {
            console.error('Export All failed:', err);
            Modals.showInfo(I18n.get('error_title'), I18n.get('export_all_error'));
        }
    },

    async refreshStats() {

        const count = await API.getDocCount();
        const el = document.getElementById('doc-count');
        if (el) el.textContent = count;
    },

    async handleSearch(query) {
        const treeContainer = document.getElementById('tree-container');
        const allItems = treeContainer.querySelectorAll('li[data-id]');

        // If query is empty, show all
        // If query is empty, show all and clear highlights
        if (query.length < 1) {
            allItems.forEach(li => {
                li.style.display = '';
                li.classList.remove('search-match');
                const titleSpan = li.querySelector('.tree-title');
                if (titleSpan && titleSpan.dataset.original) {
                    titleSpan.textContent = titleSpan.dataset.original;
                    delete titleSpan.dataset.original;
                }
            });
            Editor.applyHighlight('');
            return;
        }

        // Get matching IDs from server
        const result = await API.search(query);
        const visibleIds = new Set([...result.matches, ...result.ancestors]);

        // Highlight pattern in editor if document is open
        Editor.applyHighlight(query);

        // Filter tree and highlight pattern
        allItems.forEach(li => {
            const id = parseInt(li.dataset.id);
            const titleSpan = li.querySelector('.tree-title');

            // Revert to original title first
            if (titleSpan.dataset.original) {
                titleSpan.textContent = titleSpan.dataset.original;
            }

            if (visibleIds.has(id)) {
                li.style.display = '';
                const isMatch = result.matches.includes(id);
                li.classList.toggle('search-match', isMatch);

                if (isMatch) {
                    // Save original if not saved
                    if (!titleSpan.dataset.original) {
                        titleSpan.dataset.original = titleSpan.textContent;
                    }
                    // Highlight pattern
                    const text = titleSpan.dataset.original;
                    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regex = new RegExp(`(${escaped})`, 'gi');
                    titleSpan.innerHTML = text.replace(regex, '<mark>$1</mark>');
                }
            } else {
                li.style.display = 'none';
                li.classList.remove('search-match');
            }
        });
    },



    downloadFile(filename, text) {
        const mimeType = filename.endsWith('.md') ? 'text/markdown' : 'text/html';
        const blob = new Blob([text], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const element = document.createElement('a');
        element.href = url;
        element.download = filename;
        element.style.display = 'none';
        document.body.appendChild(element);
        element.click();
        setTimeout(() => {
            document.body.removeChild(element);
            URL.revokeObjectURL(url);
        }, 100);
    },

    async backupDb() {
        try {
            const data = await API.backupData();
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });

            if ('showSaveFilePicker' in window) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: 'notebook.backup.json',
                        types: [{
                            description: 'Notebook Backup',
                            accept: { 'application/json': ['.json'] }
                        }]
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.error('Backup failed:', err);
                        // Fallback: download via blob URL
                        this.downloadFile('notebook.backup.json', json);
                    }
                }
            } else {
                this.downloadFile('notebook.backup.json', json);
            }
        } catch (err) {
            console.error('Backup failed:', err);
            Modals.showInfo(I18n.get('error_title'), err.message || 'Backup failed');
        }
    },

    async importDb() {
        Modals.showConfirm(
            I18n.get('confirm_import_title'),
            I18n.get('confirm_import_text'),
            async () => {
                try {
                    let file;
                    if ('showOpenFilePicker' in window) {
                        const [handle] = await window.showOpenFilePicker({
                            types: [{
                                description: 'Notebook Backup',
                                accept: { 'application/json': ['.json'] }
                            }],
                            multiple: false
                        });
                        file = await handle.getFile();
                    } else {
                        // Fallback for browsers without showOpenFilePicker
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.json';
                        file = await new Promise((resolve) => {
                            input.onchange = () => resolve(input.files[0]);
                            input.click();
                        });
                    }

                    if (!file) return;

                    // Read and parse JSON file
                    const text = await file.text();
                    let data;
                    try {
                        data = JSON.parse(text);
                    } catch (e) {
                        alert('Import failed: invalid JSON file');
                        return;
                    }

                    // Import data into chrome.storage
                    await API.importData(data);

                    // Reload the UI
                    await Tree.refresh();
                    Editor.clear();
                    Main.refreshStats();
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.error('Import failed:', err);
                        alert('Import failed: ' + err.message);
                    }
                }
            },
            'danger'
        );
    },

    async exportShortcuts() {
        try {
            const data = await API.backupShortcuts();
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });

            if ('showSaveFilePicker' in window) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: 'notebook.home.json',
                        types: [{
                            description: 'Shortcuts Backup',
                            accept: { 'application/json': ['.json'] }
                        }]
                    });
                    const writable = await handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.error('Backup failed:', err);
                        this.downloadFile('notebook.home.json', json);
                    }
                }
            } else {
                this.downloadFile('notebook.home.json', json);
            }
        } catch (err) {
            console.error('Backup failed:', err);
            Modals.showInfo(I18n.get('error_title'), err.message || 'Export failed');
        }
    },

    async importShortcuts() {
        try {
            let file;
            if ('showOpenFilePicker' in window) {
                const [handle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'Shortcuts Backup',
                        accept: { 'application/json': ['.json'] }
                    }],
                    multiple: false
                });
                file = await handle.getFile();
            } else {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json';
                file = await new Promise((resolve) => {
                    input.onchange = () => resolve(input.files[0]);
                    input.click();
                });
            }

            if (!file) return;

            const text = await file.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                alert('Import failed: invalid JSON file');
                return;
            }

            if (data.type !== 'shortcuts') {
                alert('Import failed: Not a valid shortcuts file.');
                return;
            }

            await API.importShortcuts(data);
            await this.loadShortcutTabs();
            await this.loadShortcuts();
            Modals.showInfo(I18n.get('notice_title') || 'Notice', 'Shortcuts imported successfully');
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Import failed:', err);
                alert('Import failed: ' + err.message);
            }
        }
    }
};

window.onload = () => Main.init();
