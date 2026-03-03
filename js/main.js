/* ============================================
   THE FUN MAP - Main Application Entry Point
   ============================================ */

(function () {
    'use strict';

    // Boot sequence
    const bootScreen = document.getElementById('boot-screen');
    const loaderBar = bootScreen.querySelector('.boot-loader-bar');
    const bootStatus = bootScreen.querySelector('.boot-status');
    const app = document.getElementById('app');

    const bootSteps = [
        { progress: 15, text: 'LOADING MAP ENGINE...' },
        { progress: 30, text: 'INITIALIZING CARTOGRAPHIC SYSTEMS...' },
        { progress: 45, text: 'CONFIGURING DATA LAYERS...' },
        { progress: 60, text: 'CONNECTING TO SATELLITE FEEDS...' },
        { progress: 75, text: 'LOADING USER PREFERENCES...' },
        { progress: 90, text: 'CALIBRATING SENSORS...' },
        { progress: 100, text: 'SYSTEMS READY' },
    ];

    let stepIndex = 0;

    function runBootStep() {
        if (stepIndex >= bootSteps.length) {
            // Boot complete
            setTimeout(() => {
                bootScreen.classList.add('fade-out');
                app.classList.remove('hidden');

                // Initialize all modules
                initApp();

                // Remove boot screen after fade
                setTimeout(() => {
                    bootScreen.remove();
                }, 800);
            }, 400);
            return;
        }

        const step = bootSteps[stepIndex];
        loaderBar.style.width = step.progress + '%';
        bootStatus.textContent = step.text;
        stepIndex++;

        setTimeout(runBootStep, 250 + Math.random() * 200);
    }

    function initApp() {
        try {
            // Initialize modules in order
            FunMap.Map.init();
            FunMap.Sentinel.init();
            FunMap.FIRMS.init();
            FunMap.Conflict.init();
            FunMap.Pins.init();
            FunMap.Janus.init();
            FunMap.UI.init();

            // Set data timestamp
            document.getElementById('data-timestamp').textContent =
                new Date().toLocaleString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });

            // Check for API keys and show hint if missing
            const hasCDSE = FunMap.Settings.getApiKey('cdse_client_id');
            const hasFIRMS = FunMap.Settings.getApiKey('firms_key');

            if (!hasCDSE && !hasFIRMS) {
                setTimeout(() => {
                    FunMap.Utils.toast(
                        'Configure API keys in Settings to load satellite and fire data. UCDP conflict data works without keys.',
                        'info',
                        8000
                    );
                }, 1500);
            }

            FunMap.Utils.setStatus('SYSTEMS ONLINE');
            console.log('%c THE FUN MAP %c Initialized successfully ',
                'background:#87c540;color:#000;font-weight:bold;padding:4px 8px;',
                'background:#1a1a1a;color:#87c540;padding:4px 8px;');

        } catch (err) {
            console.error('Initialization error:', err);
            FunMap.Utils.toast('Initialization error: ' + err.message, 'error');
        }
    }

    // Start boot sequence
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runBootStep);
    } else {
        runBootStep();
    }
})();
