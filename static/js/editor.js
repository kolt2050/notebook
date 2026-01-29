const Editor = {
    titleInput: document.getElementById('doc-title'),
    contentArea: document.getElementById('editor'),
    currentDoc: null,

    init() {
        document.getElementById('delete-btn').onclick = () => this.delete();

        // Support pasting images
        this.contentArea.onpaste = (e) => this.handlePaste(e);

        // Initialize resizer
        ImageResizer.init(this);

        // Ensure consistent line behavior (divs for new lines)
        document.execCommand('defaultParagraphSeparator', false, 'div');

        // Ctrl+Click navigation for links
        this.contentArea.onclick = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.target.tagName === 'A') {
                e.preventDefault();
                window.open(e.target.href, '_blank');
            }
        };

        // Visual feedback for Ctrl key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Control' || e.key === 'Meta') {
                this.contentArea.classList.add('ctrl-down');
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.key === 'Control' || e.key === 'Meta') {
                this.contentArea.classList.remove('ctrl-down');
            }
        });
    },

    format(cmd, val) {
        if (cmd === 'removeFormat') {
            document.execCommand('removeFormat', false, val);
            // Further clean up: remove all 'style' attributes from elements in selection
            const selection = window.getSelection();
            if (!selection.rangeCount) return;
            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;
            const elements = (container.nodeType === 1 ? [container] : []).concat(
                Array.from((container.nodeType === 1 ? container : container.parentNode).querySelectorAll('*'))
            );

            elements.forEach(el => {
                if (selection.containsNode(el, true)) {
                    el.removeAttribute('style');
                }
            });
        } else {
            document.execCommand(cmd, false, val);
        }
        this.contentArea.focus();
    },


    handlePaste(e) {
        const clipboardData = e.clipboardData || window.clipboardData;
        const items = clipboardData.items;

        // Check for images first
        for (const item of items) {
            if (item.type.indexOf('image') !== -1) {
                e.preventDefault();
                const file = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = `<img src="${event.target.result}" alt="Pasted Image">`;
                    this.format('insertHTML', img);
                };
                reader.readAsDataURL(file);
                return;
            }
        }

        // Handle text paste
        e.preventDefault();
        const text = clipboardData.getData('text/plain');

        // Check if the pasted text is a URL
        const urlRegex = /^(https?:\/\/[^\s]+)$/i;
        const trimmedText = text.trim();

        if (urlRegex.test(trimmedText)) {
            const html = `<a href="${trimmedText}" target="_blank" title="${I18n.get('ctrl_click_hint')}">${trimmedText}</a>`;
            this.format('insertHTML', html);
        } else {
            this.format('insertText', text);
        }
    },

    insertImage() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = e => {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onload = () => {
                const img = `<img src="${reader.result}" alt="${file.name}">`;
                this.format('insertHTML', img);
            };
            reader.readAsDataURL(file);
        };
        input.click();
    },

    load(doc) {
        ImageResizer.deselect();
        this.currentDoc = doc;
        this.titleInput.value = doc.title;
        this.contentArea.innerHTML = doc.content || '';
        this.contentArea.setAttribute('placeholder', I18n.get('doc_title_placeholder'));

        // Highlight search pattern if active
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value) {
            this.applyHighlight(searchInput.value);
        }
    },

    clear() {
        ImageResizer.deselect();
        this.currentDoc = null;
        this.titleInput.value = '';
        this.contentArea.innerHTML = '';
        this.contentArea.setAttribute('placeholder', I18n.get('doc_title_placeholder'));
    },

    async save() {
        if (!this.currentDoc) return;

        // Remove highlights before saving
        this.removeHighlights();

        const newTitle = this.titleInput.value.trim();
        const newContent = this.contentArea.innerHTML;

        // Don't save if nothing changed
        if (newTitle === this.currentDoc.title && newContent === this.currentDoc.content) {
            return;
        }

        const data = {
            title: newTitle,
            content: newContent
        };

        await API.updateDocument(this.currentDoc.id, data);

        // Only refresh tree if title changed
        if (newTitle !== this.currentDoc.title) {
            await Tree.refresh();
        }

        // Update local reference
        this.currentDoc.title = newTitle;
        this.currentDoc.content = newContent;

        // Restore highlights if there's an active search
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value) {
            this.applyHighlight(searchInput.value);
        }
    },

    removeHighlights() {
        const highlights = this.contentArea.querySelectorAll('mark.search-highlight');
        highlights.forEach(mark => {
            const parent = mark.parentNode;
            while (mark.firstChild) {
                parent.insertBefore(mark.firstChild, mark);
            }
            parent.removeChild(mark);
        });
        this.contentArea.normalize();
    },

    applyHighlight(query) {
        this.removeHighlights();
        if (!query || query.length < 1) return;

        const walker = document.createTreeWalker(this.contentArea, NodeFilter.SHOW_TEXT, null, false);
        const nodes = [];
        let node;
        while (node = walker.nextNode()) {
            nodes.push(node);
        }

        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');

        nodes.forEach(textNode => {
            const val = textNode.nodeValue;
            regex.lastIndex = 0;
            if (regex.test(val)) {
                const fragment = document.createDocumentFragment();
                let lastIdx = 0;
                val.replace(regex, (match, p1, offset) => {
                    fragment.appendChild(document.createTextNode(val.substring(lastIdx, offset)));
                    const mark = document.createElement('mark');
                    mark.className = 'search-highlight';
                    mark.textContent = match;
                    fragment.appendChild(mark);
                    lastIdx = offset + match.length;
                    return match;
                });
                fragment.appendChild(document.createTextNode(val.substring(lastIdx)));
                textNode.parentNode.replaceChild(fragment, textNode);
            }
        });
    },

    async delete() {
        if (!this.currentDoc) return;
        Modals.show(
            I18n.get('confirm_delete_title'),
            I18n.get('confirm_delete_text', { title: this.currentDoc.title }),
            async () => {
                await API.deleteDocument(this.currentDoc.id);
                this.clear();
                Tree.refresh();
            },
            'danger'
        );
    }
};

const ImageResizer = {
    editor: null,
    activeImg: null,
    handles: [],
    isResizing: false,
    startWidth: 0,
    startHeight: 0,
    startX: 0,
    startY: 0,
    aspectRatio: 1,

    init(editor) {
        this.editor = editor;
        this.editor.contentArea.addEventListener('click', (e) => {
            if (e.target.tagName === 'IMG') {
                this.selectImage(e.target);
            } else if (!e.target.classList.contains('img-resize-handle')) {
                this.deselect();
            }
        });

        // Hide handles on scroll or window resize
        this.editor.contentArea.addEventListener('scroll', () => this.updateHandlePositions());
        window.addEventListener('resize', () => this.updateHandlePositions());

        // Global mouse events for resizing
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', () => this.handleMouseUp());
    },

    selectImage(img) {
        if (this.activeImg === img) return;
        this.deselect();
        this.activeImg = img;
        this.activeImg.classList.add('selected-for-resize');
        this.createHandles();
    },

    deselect() {
        if (this.activeImg) {
            this.activeImg.classList.remove('selected-for-resize');
            this.activeImg = null;
        }
        this.removeHandles();
    },

    createHandles() {
        const positions = ['nw', 'ne', 'sw', 'se'];
        positions.forEach(pos => {
            const handle = document.createElement('div');
            handle.className = `img-resize-handle ${pos}`;
            handle.onmousedown = (e) => this.handleMouseDown(e, pos);
            document.body.appendChild(handle);
            this.handles.push(handle);
        });
        this.updateHandlePositions();
    },

    removeHandles() {
        this.handles.forEach(h => h.remove());
        this.handles = [];
    },

    updateHandlePositions() {
        if (!this.activeImg) return;
        const rect = this.activeImg.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        const hRects = {
            nw: { top: rect.top + scrollY, left: rect.left + scrollX },
            ne: { top: rect.top + scrollY, left: rect.right + scrollX },
            sw: { top: rect.bottom + scrollY, left: rect.left + scrollX },
            se: { top: rect.bottom + scrollY, left: rect.right + scrollX }
        };

        this.handles.forEach(h => {
            const pos = h.classList.contains('nw') ? 'nw' :
                h.classList.contains('ne') ? 'ne' :
                    h.classList.contains('sw') ? 'sw' : 'se';
            const p = hRects[pos];
            h.style.top = `${p.top - 6}px`;
            h.style.left = `${p.left - 6}px`;
        });
    },

    handleMouseDown(e, pos) {
        e.preventDefault();
        e.stopPropagation();
        this.isResizing = true;
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.startWidth = this.activeImg.offsetWidth;
        this.startHeight = this.activeImg.offsetHeight;
        this.aspectRatio = this.startWidth / this.startHeight;
    },

    handleMouseMove(e) {
        if (!this.isResizing || !this.activeImg) return;

        const deltaX = e.clientX - this.startX;
        let newWidth = this.startWidth + deltaX;

        // Clamp min size
        if (newWidth < 20) newWidth = 20;

        // Proportional height
        const newHeight = newWidth / this.aspectRatio;

        this.activeImg.style.width = `${newWidth}px`;
        this.activeImg.style.height = `${newHeight}px`;

        this.updateHandlePositions();
    },

    handleMouseUp() {
        if (this.isResizing) {
            this.isResizing = false;
            // Trigger save after resize
            Editor.save();
        }
    }
};

Editor.init();
