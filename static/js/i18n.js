const I18n = {
    current: localStorage.getItem('lang') || 'EN',
    strings: {
        EN: {
            app_title: "Notebook",
            add_doc: "Add Document",
            backup_db: "Backup DB",
            search_placeholder: "Search...",
            export_all: "Export All",
            total_docs: "Total documents: ",
            reset_notebook: "Reset Notebook",
            doc_title_placeholder: "Document Title...",
            clear_format: "Clear format",
            clear_format_title: "Clear all formatting",
            export_md: "Export",
            delete_btn: "Delete",
            modal_cancel: "Cancel",
            modal_confirm: "Confirm",
            confirm_delete_title: "Delete Document",
            confirm_delete_text: "Delete \"{title}\" and all its sub-documents?",
            confirm_reset_title: "Reset Notebook",
            confirm_reset_text: "<p>Are you sure you want to delete ALL documents? This action cannot be undone.</p>",
            notice_title: "Notice",
            error_title: "Error",
            select_first: "Please select a document first.",
            converter_error: "Markdown converter not loaded. Please check your connection.",
            export_all_error: "Failed to export all documents",
            move_error_title: "Error",
            move_circular_error: "Cannot move a document into its own sub-document.",
            move_failed: "Failed to move document",
            new_doc_title: "New Document",
            add_sub_doc: "Add Sub-document",
            delete_tooltip: "Delete",
            ctrl_click_hint: "Ctrl + Click to follow link"
        },
        RU: {
            app_title: "Блокнот",
            add_doc: "Добавить документ",
            backup_db: "Бэкап БД",
            search_placeholder: "Поиск...",
            export_all: "Экспортировать всё",
            total_docs: "Всего документов: ",
            reset_notebook: "Очистить блокнот",
            doc_title_placeholder: "Заголовок документа...",
            clear_format: "Очистить формат",
            clear_format_title: "Удалить всё форматирование",
            export_md: "Экспорт",
            delete_btn: "Удалить",
            modal_cancel: "Отмена",
            modal_confirm: "Ок",
            confirm_delete_title: "Удалить документ",
            confirm_delete_text: "Удалить \"{title}\" и все вложенные документы?",
            confirm_reset_title: "Сброс блокнота",
            confirm_reset_text: "<p>Вы уверены, что хотите удалить ВСЕ документы? Это действие нельзя отменить.</p>",
            notice_title: "Уведомление",
            error_title: "Ошибка",
            select_first: "Сначала выберите документ.",
            converter_error: "Конвертер Markdown не загружен. Проверьте соединение.",
            export_all_error: "Не удалось экспортировать все документы",
            move_error_title: "Ошибка",
            move_circular_error: "Нельзя переместить документ в его собственный поддокумент.",
            move_failed: "Не удалось переместить документ",
            new_doc_title: "Новый документ",
            add_sub_doc: "Добавить поддокумент",
            delete_tooltip: "Удалить",
            ctrl_click_hint: "Ctrl + Клик для перехода по ссылке"
        }
    },

    get(key, params = {}) {
        let str = this.strings[this.current][key] || key;
        for (const [p, val] of Object.entries(params)) {
            str = str.replace(`{${p}}`, val);
        }
        return str;
    },

    toggle() {
        this.current = this.current === 'EN' ? 'RU' : 'EN';
        localStorage.setItem('lang', this.current);
        this.apply();
        // Update components that might need re-render or internal update
        if (window.Tree) Tree.refresh();
        if (window.Main) Main.refreshStats();
        if (window.Editor && Editor.currentDoc) {
            Editor.contentArea.setAttribute('placeholder', this.get('doc_title_placeholder'));
        }
    },

    apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            const attr = el.dataset.i18nAttr;
            if (attr) {
                el.setAttribute(attr, this.get(key));
            } else {
                el.textContent = this.get(key);
            }
        });

        // Update placeholders separately if they don't use data-i18n-attr
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = this.get(el.dataset.i18nPlaceholder);
        });

        // Update language button text
        const btn = document.getElementById('lang-toggle-btn');
        if (btn) btn.textContent = this.current;
    },

    init() {
        this.apply();
    }
};
