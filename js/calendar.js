/* ============================================
   THE FUN MAP - Custom Calendar Widget
   Green-highlighted available image dates
   ============================================ */

FunMap.Calendar = {
    _instances: {},  // inputId -> { panel, availableDates, year, month }

    /**
     * Attach a calendar to a text input.
     * @param {string} inputId - The input element ID
     */
    attach(inputId) {
        const input = document.getElementById(inputId);
        if (!input || this._instances[inputId]) return;

        // Change type to text to prevent native date picker
        input.type = 'text';
        input.readOnly = true;
        input.style.cursor = 'pointer';
        input.placeholder = 'YYYY-MM-DD';

        // Create panel
        const panel = document.createElement('div');
        panel.className = 'cal-panel hidden';
        panel.id = 'cal-' + inputId;
        document.body.appendChild(panel);

        const now = new Date();
        const inst = {
            panel: panel,
            input: input,
            availableDates: new Set(),
            year: now.getFullYear(),
            month: now.getMonth(),
        };
        this._instances[inputId] = inst;

        // If input already has a value, parse it for initial month
        if (input.value) {
            const parts = input.value.split('-');
            if (parts.length === 3) {
                inst.year = parseInt(parts[0]);
                inst.month = parseInt(parts[1]) - 1;
            }
        }

        // Toggle calendar on input click
        input.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggle(inputId);
        });

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && e.target !== input) {
                panel.classList.add('hidden');
            }
        });

        // Prevent panel clicks from closing
        panel.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    },

    /**
     * Set available dates for an input's calendar.
     * @param {string} inputId
     * @param {string[]} dates - Array of 'YYYY-MM-DD' strings
     */
    setAvailableDates(inputId, dates) {
        const inst = this._instances[inputId];
        if (!inst) return;
        inst.availableDates = new Set(dates);
        // Re-render if panel is visible
        if (!inst.panel.classList.contains('hidden')) {
            this._render(inputId);
        }
    },

    /**
     * Set available dates for multiple inputs at once.
     * @param {string[]} inputIds
     * @param {string[]} dates
     */
    setAvailableDatesMulti(inputIds, dates) {
        inputIds.forEach(id => this.setAvailableDates(id, dates));
    },

    /**
     * Programmatically set value on a calendar input.
     */
    setValue(inputId, dateStr) {
        const inst = this._instances[inputId];
        if (!inst) return;
        inst.input.value = dateStr;
        if (dateStr) {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                inst.year = parseInt(parts[0]);
                inst.month = parseInt(parts[1]) - 1;
            }
        }
    },

    _toggle(inputId) {
        const inst = this._instances[inputId];
        if (!inst) return;

        // Close all other calendars first
        Object.keys(this._instances).forEach(id => {
            if (id !== inputId) {
                this._instances[id].panel.classList.add('hidden');
            }
        });

        const wasHidden = inst.panel.classList.contains('hidden');
        if (wasHidden) {
            this._render(inputId);
            this._position(inputId);
            inst.panel.classList.remove('hidden');
        } else {
            inst.panel.classList.add('hidden');
        }
    },

    _position(inputId) {
        const inst = this._instances[inputId];
        const rect = inst.input.getBoundingClientRect();
        const panel = inst.panel;
        panel.style.position = 'fixed';
        panel.style.top = (rect.bottom + 4) + 'px';
        panel.style.left = rect.left + 'px';
        panel.style.zIndex = '6000';

        // Ensure it doesn't go off-screen right
        requestAnimationFrame(() => {
            const panelRect = panel.getBoundingClientRect();
            if (panelRect.right > window.innerWidth - 8) {
                panel.style.left = (window.innerWidth - panelRect.width - 8) + 'px';
            }
            // Ensure it doesn't go off-screen bottom
            if (panelRect.bottom > window.innerHeight - 8) {
                panel.style.top = (rect.top - panelRect.height - 4) + 'px';
            }
        });
    },

    _render(inputId) {
        const inst = this._instances[inputId];
        const { year, month, availableDates, input } = inst;
        const selectedVal = input.value; // 'YYYY-MM-DD'

        const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
                            'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

        // First day of month and days in month
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = FunMap.Utils.toISODate(new Date());

        let html = '<div class="cal-header">';
        html += `<button class="cal-nav" data-dir="-1">&lsaquo;</button>`;
        html += `<span class="cal-title">${monthNames[month]} ${year}</span>`;
        html += `<button class="cal-nav" data-dir="1">&rsaquo;</button>`;
        html += '</div>';

        // Day names row
        html += '<div class="cal-days-header">';
        dayNames.forEach(d => {
            html += `<span class="cal-day-name">${d}</span>`;
        });
        html += '</div>';

        // Day grid
        html += '<div class="cal-grid">';

        // Empty cells before first day
        for (let i = 0; i < firstDay; i++) {
            html += '<span class="cal-cell cal-empty"></span>';
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isAvailable = availableDates.has(dateStr);
            const isSelected = dateStr === selectedVal;
            const isToday = dateStr === today;

            let cls = 'cal-cell cal-day';
            if (isAvailable) cls += ' cal-available';
            if (isSelected) cls += ' cal-selected';
            if (isToday) cls += ' cal-today';

            html += `<span class="${cls}" data-date="${dateStr}">${d}</span>`;
        }

        html += '</div>';

        // Available count
        const availableInMonth = Array.from(availableDates).filter(d => {
            return d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`);
        }).length;
        if (availableDates.size > 0) {
            html += `<div class="cal-footer">${availableInMonth} image${availableInMonth !== 1 ? 's' : ''} this month &middot; ${availableDates.size} total</div>`;
        }

        inst.panel.innerHTML = html;

        // Wire up navigation
        inst.panel.querySelectorAll('.cal-nav').forEach(btn => {
            btn.addEventListener('click', () => {
                const dir = parseInt(btn.dataset.dir);
                inst.month += dir;
                if (inst.month < 0) { inst.month = 11; inst.year--; }
                if (inst.month > 11) { inst.month = 0; inst.year++; }
                this._render(inputId);
            });
        });

        // Wire up day clicks
        inst.panel.querySelectorAll('.cal-day').forEach(cell => {
            cell.addEventListener('click', () => {
                const dateStr = cell.dataset.date;
                input.value = dateStr;
                inst.panel.classList.add('hidden');
                // Trigger change event so other code can react
                input.dispatchEvent(new Event('change', { bubbles: true }));
            });
        });
    },
};
