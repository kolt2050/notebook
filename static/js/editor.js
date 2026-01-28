const Editor = {
    titleInput: document.getElementById('doc-title'),
    contentArea: document.getElementById('editor'),
    currentDoc: null,

    init() {
        document.getElementById('bold-btn').onclick = () => this.format('bold');
        document.getElementById('remove-format-btn').onclick = () => this.format('removeFormat');
        document.getElementById('delete-btn').onclick = () => this.delete();

        // Support pasting images
        this.contentArea.onpaste = (e) => this.handlePaste(e);
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

        // Handle text paste (force plain text)
        e.preventDefault();
        const text = clipboardData.getData('text/plain');
        this.format('insertText', text);
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
        this.currentDoc = doc;
        this.titleInput.value = doc.title;
        this.contentArea.innerHTML = doc.content || '';
        this.contentArea.setAttribute('placeholder', 'Type something...');

        // Highlight search pattern if active
        const searchInput = document.getElementById('search-input');
        if (searchInput && searchInput.value) {
            this.applyHighlight(searchInput.value);
        }
    },

    clear() {
        this.currentDoc = null;
        this.titleInput.value = '';
        this.contentArea.innerHTML = '';
        this.contentArea.setAttribute('placeholder', 'Select a document to edit');
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
        Modals.show('Delete Document', `<p>Delete "${this.currentDoc.title}"?</p>`, async () => {
            await API.deleteDocument(this.currentDoc.id);
            this.clear();
            Tree.refresh();
        }, 'danger');
    }
};

Editor.init();
