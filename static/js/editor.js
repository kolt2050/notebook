const Editor = {
    titleInput: document.getElementById('doc-title'),
    contentArea: document.getElementById('editor'),
    currentDoc: null,

    init() {
        document.getElementById('delete-btn').onclick = () => this.delete();

        // Support pasting images
        this.contentArea.onpaste = (e) => this.handlePaste(e);

        // Handle text input for auto-formatting
        this.contentArea.addEventListener('input', (e) => this.handleInput(e));

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

        // Handle keydown for special behaviors (Enter in code block)
        this.contentArea.addEventListener('keydown', (e) => this.handleKeyDown(e));
    },

    handleKeyDown(e) {
        if (e.key === 'Enter') {
            const selection = window.getSelection();
            if (!selection.rangeCount) return;
            const range = selection.getRangeAt(0);
            let node = range.startContainer;

            // Find if we are inside a code block
            let inCodeBlock = false;
            let currentBlock = node;
            while (currentBlock && currentBlock !== this.contentArea) {
                if (currentBlock.tagName === 'PRE') {
                    inCodeBlock = true;
                    break;
                }
                currentBlock = currentBlock.parentNode;
            }

            if (inCodeBlock) {
                if (e.shiftKey) {
                    // Shift+Enter: Break out of code block
                    e.preventDefault();

                    // Apply syntax highlighting to the block we're leaving
                    const codeEl = currentBlock.querySelector('code');
                    if (codeEl && window.hljs) {
                        // Get plain text, strip any previous hljs markup
                        const plainText = codeEl.textContent;
                        codeEl.textContent = plainText;
                        // Re-add language class if it was set
                        const langClass = Array.from(codeEl.classList).find(c => c.startsWith('language-'));
                        codeEl.removeAttribute('data-highlighted');
                        if (langClass) {
                            codeEl.className = langClass;
                        }
                        hljs.highlightElement(codeEl);
                    }

                    const newBlock = document.createElement('div');
                    newBlock.innerHTML = '<br>'; // Empty line

                    // Insert after the pre block
                    if (currentBlock.nextSibling) {
                        currentBlock.parentNode.insertBefore(newBlock, currentBlock.nextSibling);
                    } else {
                        currentBlock.parentNode.appendChild(newBlock);
                    }

                    // Move cursor to new block
                    const newRange = document.createRange();
                    newRange.setStart(newBlock, 0);
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                } else {
                    // Enter: Insert newline inside code block
                    e.preventDefault();

                    // Insert newline character
                    const textNode = document.createTextNode('\n');
                    range.insertNode(textNode);

                    // Move cursor after newline
                    range.setStartAfter(textNode);
                    range.setEndAfter(textNode);
                    selection.removeAllRanges();
                    selection.addRange(range);

                    // Note: If this is the last character, some browsers might need an extra newline or space to show the cursor?
                    // In <pre>, a trailing \n might not show a new line visually until text is typed.
                    // But usually it works.
                }
            }
        }
    },

    handleInput(e) {
        if (e.inputType === 'insertText' || e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
            const selection = window.getSelection();
            if (!selection.rangeCount) return;

            const range = selection.getRangeAt(0);
            const node = range.startContainer;

            // 1. Handle Code Block (Enter key)
            if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') {
                // Find current block element (the one containing the cursor)
                let currentBlock = node;

                // If cursor is in a text node, get its parent (likely the div/p)
                if (currentBlock.nodeType === Node.TEXT_NODE) {
                    currentBlock = currentBlock.parentNode;
                }

                // If node is the editor itself (rare, happens if empty or cursor between blocks), find the child index
                if (currentBlock === this.contentArea) {
                    // range.startOffset is the index of the child we are at (or after)
                    const idx = range.startOffset;
                    if (idx > 0) {
                        currentBlock = this.contentArea.childNodes[idx - 1];
                    }
                }

                // Robust Previous Block Finding:
                let prevBlock = currentBlock.previousElementSibling;

                // Check if previous block matches ```lang
                const textContent = prevBlock ? prevBlock.textContent.trim().replace(/\u200B/g, '') : '';
                const match = textContent.match(/^```(\w+)?$/);

                if (prevBlock && match) {
                    const lang = match[1];

                    // Transform prevBlock into PRE
                    const pre = document.createElement('pre');
                    const code = document.createElement('code');
                    code.textContent = '\n';
                    pre.className = 'code-block';

                    if (lang) {
                        code.className = `language-${lang}`;
                    }

                    pre.appendChild(code);

                    if (prevBlock.parentNode) {
                        prevBlock.parentNode.replaceChild(pre, prevBlock);

                        // If the current block (new line) is empty, remove it to merge cursor into pre?
                        // Better to keep cursor inside PRE and remove the extra div.
                        if (currentBlock.textContent.trim() === '') {
                            currentBlock.remove();
                        }

                        // Focus inside pre
                        const newRange = document.createRange();
                        newRange.setStart(code, 0);
                        newRange.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(newRange);

                        // Don't highlight now - block is empty.
                        // Highlighting will happen when user exits (Shift+Enter) or on save/load.

                        return;
                    }
                }
            }

            // 2. Handle Inline Code (Text input)
            // Only process if we are in a text node (standard typing)
            if (node.nodeType === Node.TEXT_NODE && e.inputType === 'insertText') {
                const text = node.textContent;
                const offset = range.startOffset;
                const textBefore = text.slice(0, offset);

                // Inline Code Pattern: `text` 
                const inlineMatch = textBefore.match(/`([^`\n]+)`$/);
                if (inlineMatch) {
                    // Prevention: don't format if already inside code/pre
                    let parent = node.parentNode;
                    let isInsideCode = false;
                    while (parent && parent !== this.contentArea) {
                        if (parent.tagName === 'CODE' || parent.tagName === 'PRE') {
                            isInsideCode = true;
                            break;
                        }
                        parent = parent.parentNode;
                    }
                    if (isInsideCode) return;

                    const matchText = inlineMatch[0]; // `code`
                    const codeContent = inlineMatch[1]; // code

                    const startIdx = offset - matchText.length;

                    const before = text.slice(0, startIdx);
                    const after = text.slice(offset);

                    const code = document.createElement('code');
                    code.className = 'inline-code';
                    code.textContent = codeContent;

                    const parentNode = node.parentNode;

                    if (before) {
                        parentNode.insertBefore(document.createTextNode(before), node);
                    }

                    parentNode.insertBefore(code, node);

                    let nextNode;
                    if (after) {
                        nextNode = document.createTextNode(after);
                    } else {
                        nextNode = document.createTextNode('\u00A0'); // nbsp
                    }
                    parentNode.insertBefore(nextNode, node);

                    parentNode.removeChild(node);

                    const newRange = document.createRange();
                    newRange.setStart(nextNode, 1);
                    newRange.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                }
            }
        }
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

        // Check if inside code block
        const selection = window.getSelection();
        if (selection.rangeCount) {
            const range = selection.getRangeAt(0);
            let node = range.startContainer;
            let inCodeBlock = false;
            while (node && node !== this.contentArea) {
                if (node.tagName === 'PRE') {
                    inCodeBlock = true;
                    break;
                }
                node = node.parentNode;
            }

            if (inCodeBlock) {
                // Manual text insertion for code blocks to preserve newlines and avoid divs
                const textNode = document.createTextNode(text);
                range.deleteContents();
                range.insertNode(textNode);

                // Move cursor after pasted text
                range.setStartAfter(textNode);
                range.setEndAfter(textNode);
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
        }

        // Normal paste behavior
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

        // Apply syntax highlighting to existing blocks
        if (window.hljs) {
            this.contentArea.querySelectorAll('pre code').forEach(block => {
                hljs.highlightElement(block);
            });
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
