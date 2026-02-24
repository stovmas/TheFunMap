/* ============================================
   THE FUN MAP - User Pins & Notes
   ============================================ */

FunMap.Pins = {
    _layerGroup: null,
    _pins: [],
    _editingPin: null,
    _addMode: false,

    init() {
        this._layerGroup = L.layerGroup();
        this._layerGroup.addTo(FunMap.Map.map);

        // Load saved pins
        this._pins = FunMap.Settings.get('pins', []);
        this._renderPins();
        this._updatePinsList();

        // Layer toggle
        document.getElementById('layer-pins').addEventListener('change', (e) => {
            if (e.target.checked) {
                this._layerGroup.addTo(FunMap.Map.map);
            } else {
                FunMap.Map.map.removeLayer(this._layerGroup);
            }
            FunMap.Map.updateLayerCount();
        });

        // Add pin button
        document.getElementById('btn-add-pin').addEventListener('click', () => {
            this._startAddPin();
        });

        // Pin dialog buttons
        document.getElementById('btn-pin-save').addEventListener('click', () => {
            this._savePin();
        });
        document.getElementById('btn-pin-cancel').addEventListener('click', () => {
            this._closePinDialog();
        });
        document.getElementById('btn-pin-delete').addEventListener('click', () => {
            this._deletePin();
        });
        const pinDialog = document.getElementById('pin-dialog');
        pinDialog.querySelector('.close-modal').addEventListener('click', () => {
            this._closePinDialog();
        });
        pinDialog.addEventListener('click', (e) => {
            if (e.target === pinDialog) this._closePinDialog();
        });

        // Color swatches
        document.querySelectorAll('.color-swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
            });
        });

        // Export/Import
        document.getElementById('btn-export-pins').addEventListener('click', () => {
            this._exportPins();
        });
        document.getElementById('btn-import-pins').addEventListener('click', () => {
            document.getElementById('import-pins-file').click();
        });
        document.getElementById('import-pins-file').addEventListener('change', (e) => {
            this._importPins(e);
        });
    },

    _startAddPin() {
        this._addMode = true;
        FunMap.Map.map.getContainer().style.cursor = 'crosshair';
        FunMap.Utils.toast('Click on the map to place a pin', 'info');
        FunMap.Utils.setStatus('CLICK MAP TO PLACE PIN');

        const handler = (e) => {
            FunMap.Map.map.off('click', handler);
            FunMap.Map.map.getContainer().style.cursor = '';
            this._addMode = false;
            this.openPinDialog(e.latlng);
            FunMap.Utils.setStatus('SYSTEMS ONLINE');
        };
        FunMap.Map.map.on('click', handler);
    },

    openPinDialog(latlng, existingPin = null) {
        this._editingPin = existingPin;

        const dialog = document.getElementById('pin-dialog');
        const title = document.getElementById('pin-dialog-title');
        const deleteBtn = document.getElementById('btn-pin-delete');

        if (existingPin) {
            title.textContent = 'EDIT PIN';
            deleteBtn.classList.remove('hidden');
            document.getElementById('pin-title').value = existingPin.title || '';
            document.getElementById('pin-notes').value = existingPin.notes || '';
            document.getElementById('pin-category').value = existingPin.category || 'general';
            document.getElementById('pin-coords').value =
                `${existingPin.lat.toFixed(6)}, ${existingPin.lng.toFixed(6)}`;

            // Set color
            document.querySelectorAll('.color-swatch').forEach(s => {
                s.classList.toggle('active', s.dataset.color === existingPin.color);
            });
        } else {
            title.textContent = 'ADD PIN';
            deleteBtn.classList.add('hidden');
            document.getElementById('pin-title').value = '';
            document.getElementById('pin-notes').value = '';
            document.getElementById('pin-category').value = 'general';
            document.getElementById('pin-coords').value =
                `${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`;
            this._tempLatlng = latlng;

            // Reset color to default
            document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
            document.querySelector('.color-swatch[data-color="#87c540"]').classList.add('active');
        }

        dialog.classList.remove('hidden');
        document.getElementById('pin-title').focus();
    },

    _closePinDialog() {
        document.getElementById('pin-dialog').classList.add('hidden');
        this._editingPin = null;
        this._tempLatlng = null;
    },

    _savePin() {
        const titleVal = document.getElementById('pin-title').value.trim();
        if (!titleVal) {
            FunMap.Utils.toast('Please enter a title for the pin', 'warning');
            return;
        }

        const notes = document.getElementById('pin-notes').value.trim();
        const category = document.getElementById('pin-category').value;
        const activeColor = document.querySelector('.color-swatch.active');
        const color = activeColor ? activeColor.dataset.color : '#87c540';

        if (this._editingPin) {
            // Update existing
            const pin = this._pins.find(p => p.id === this._editingPin.id);
            if (pin) {
                pin.title = titleVal;
                pin.notes = notes;
                pin.category = category;
                pin.color = color;
                pin.updatedAt = new Date().toISOString();
            }
        } else {
            // Create new
            const newPin = {
                id: FunMap.Utils.uid(),
                title: titleVal,
                notes: notes,
                category: category,
                color: color,
                lat: this._tempLatlng.lat,
                lng: this._tempLatlng.lng,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            this._pins.push(newPin);
        }

        this._save();
        this._renderPins();
        this._updatePinsList();
        this._closePinDialog();
        FunMap.Utils.toast('Pin saved', 'success');
    },

    _deletePin() {
        if (!this._editingPin) return;

        this._pins = this._pins.filter(p => p.id !== this._editingPin.id);
        this._save();
        this._renderPins();
        this._updatePinsList();
        this._closePinDialog();
        FunMap.Utils.toast('Pin deleted', 'info');
    },

    _save() {
        FunMap.Settings.set('pins', this._pins);
    },

    _renderPins() {
        this._layerGroup.clearLayers();

        this._pins.forEach(pin => {
            const icon = FunMap.Utils.pinIcon(pin.color);
            const marker = L.marker([pin.lat, pin.lng], { icon: icon, draggable: true });

            const cat = FunMap.Config.PinCategories[pin.category] || FunMap.Config.PinCategories.general;

            let popupHtml = `<div class="popup-content">
                <h4>${cat.icon} ${this._escapeHtml(pin.title)}</h4>`;
            if (pin.notes) {
                popupHtml += `<p style="font-size:11px;color:var(--xbox-text);margin:4px 0;">${this._escapeHtml(pin.notes)}</p>`;
            }
            popupHtml += `<table>
                <tr><td>Category</td><td>${cat.label}</td></tr>
                <tr><td>Created</td><td>${FunMap.Utils.formatDate(pin.createdAt)}</td></tr>
                <tr><td>Location</td><td>${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}</td></tr>
            </table>
            <div class="popup-actions">
                <button class="xbox-btn xs" onclick="FunMap.Pins._editPinById('${pin.id}')">EDIT</button>
                <button class="xbox-btn xs accent" onclick="FunMap.Pins._deletePinById('${pin.id}')">DELETE</button>
            </div></div>`;

            marker.bindPopup(popupHtml);

            marker.on('click', () => {
                FunMap.Utils.showFeatureInfo('USER PIN', [
                    ['Title', pin.title],
                    ['Notes', pin.notes || '--'],
                    ['Category', cat.label],
                    ['Created', FunMap.Utils.formatDate(pin.createdAt)],
                    ['Lat', pin.lat.toFixed(6)],
                    ['Lng', pin.lng.toFixed(6)],
                ]);
            });

            // Handle drag to reposition
            marker.on('dragend', (e) => {
                const newPos = e.target.getLatLng();
                pin.lat = newPos.lat;
                pin.lng = newPos.lng;
                pin.updatedAt = new Date().toISOString();
                this._save();
                this._updatePinsList();
                FunMap.Utils.toast('Pin moved', 'info');
            });

            this._layerGroup.addLayer(marker);
        });
    },

    _updatePinsList() {
        const list = document.getElementById('pins-list');

        if (this._pins.length === 0) {
            list.innerHTML = '<div class="empty-state">No pins yet. Click "+ PIN" or right-click the map.</div>';
            return;
        }

        let html = '';
        this._pins.forEach(pin => {
            const cat = FunMap.Config.PinCategories[pin.category] || FunMap.Config.PinCategories.general;
            html += `<div class="pin-item" data-pin-id="${pin.id}" onclick="FunMap.Pins._flyToPin('${pin.id}')">
                <div class="pin-dot" style="background:${pin.color}"></div>
                <span class="pin-item-title">${this._escapeHtml(pin.title)}</span>
                <span class="pin-item-cat">${cat.label}</span>
            </div>`;
        });
        list.innerHTML = html;
    },

    _flyToPin(id) {
        const pin = this._pins.find(p => p.id === id);
        if (pin) {
            FunMap.Map.flyTo(pin.lat, pin.lng, 14);
        }
    },

    _editPinById(id) {
        const pin = this._pins.find(p => p.id === id);
        if (pin) {
            FunMap.Map.map.closePopup();
            this.openPinDialog(null, pin);
        }
    },

    _deletePinById(id) {
        this._pins = this._pins.filter(p => p.id !== id);
        this._save();
        this._renderPins();
        this._updatePinsList();
        FunMap.Map.map.closePopup();
        FunMap.Utils.toast('Pin deleted', 'info');
    },

    _exportPins() {
        if (this._pins.length === 0) {
            FunMap.Utils.toast('No pins to export', 'info');
            return;
        }

        const data = JSON.stringify(this._pins, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `funmap-pins-${FunMap.Utils.toISODate(new Date())}.json`;
        a.click();
        URL.revokeObjectURL(url);
        FunMap.Utils.toast(`Exported ${this._pins.length} pins`, 'success');
    },

    _importPins(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const imported = JSON.parse(event.target.result);
                if (!Array.isArray(imported)) throw new Error('Invalid format');

                let count = 0;
                imported.forEach(pin => {
                    if (pin.lat && pin.lng && pin.title) {
                        pin.id = pin.id || FunMap.Utils.uid();
                        if (!this._pins.find(p => p.id === pin.id)) {
                            this._pins.push(pin);
                            count++;
                        }
                    }
                });

                this._save();
                this._renderPins();
                this._updatePinsList();
                FunMap.Utils.toast(`Imported ${count} pins`, 'success');
            } catch (err) {
                FunMap.Utils.toast('Failed to import pins: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);

        // Reset file input
        e.target.value = '';
    },

    _escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },
};
