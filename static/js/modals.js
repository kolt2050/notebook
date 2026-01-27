const Modals = {
    container: document.getElementById('modal-container'),
    title: document.getElementById('modal-title'),
    body: document.getElementById('modal-body'),
    confirmBtn: document.getElementById('modal-confirm'),
    cancelBtn: document.getElementById('modal-cancel'),

    onConfirm: null,

    init() {
        this.cancelBtn.onclick = () => this.hide();
        this.confirmBtn.onclick = () => {
            if (this.onConfirm) this.onConfirm();
            this.hide();
        };
    },

    show(title, bodyHtml, onConfirm) {
        this.title.textContent = title;
        this.body.innerHTML = bodyHtml;
        this.onConfirm = onConfirm;
        this.container.classList.remove('hidden');
    },

    hide() {
        this.container.classList.add('hidden');
        this.onConfirm = null;
    }
};

Modals.init();
