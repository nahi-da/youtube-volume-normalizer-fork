function writer() {
    var inline_script = `
function waitForElem(selector, parent) {
    var time = 0;
    return new Promise(function (resolve, reject) {
        const interval = setInterval(function () {
            if (time++ > 50) {
                clearInterval(interval);
                console.error(\`[Normalizer] not found '\$\{selector\}'\`);
                return reject(null);
            }
            const elem = parent.querySelector(selector);
            if (elem) {
                clearInterval(interval);
                console.log(\`[Normalizer] found '\$\{selector\}'\`);
                return resolve(elem);
            } else {
                console.log(\`[Normalizer] wait for '\$\{selector\}'\`);
            }
        }, 100);
    });
}

function waitForFunc(conditional, arg) {
    var time = 0;
    return new Promise(function (resolve, reject) {
        const interval = setInterval(function () {
            if (time++ > 50) {
                clearInterval(interval);
                console.error('[Normalizer] timeout');
                return reject(null);
            }
            const res = conditional(arg);
            if (res) {
                clearInterval(interval);
                console.log('[Normalizer] true');
                return resolve(res);
            } else {
                console.log('[Normalizer] retry');
            }
        }, 100);
    });
}

class TestClass {
    constructor() {
        this.myGain = 1;

        this.useDefault = true;

        this.observer = new MutationObserver(mutations => {
            this.update();
        });

        this.numToSkip = 0;
    }

    async init(moviePlayer) {
        this.moviePlayer = moviePlayer
        this.basicGain = parseFloat(this.moviePlayer.getVolume()) / 100;
        this.contentLoudness = Math.round(this.myGain * this.basicGain * 100);
        this.observer.observe(this.moviePlayer, {
            characterData: true,
            childList: true,
            subtree: true,
        });
    }

    refresh() {
        this.basicGain = parseFloat(this.moviePlayer.getVolume()) / 100;
        this.contentLoudness = Math.round(this.myGain * this.basicGain * 100);
    }

    getDb() {
        var ytPlayer = this.moviePlayer.getPlayerResponse();
        if (ytPlayer && ytPlayer.playerConfig && ytPlayer.playerConfig.audioConfig) {
            return ytPlayer.playerConfig.audioConfig.loudnessDb;
        }
    }

    setUseDefault() {
        this.useDefault = true;
    }

    unsetUseDefault() {
        this.useDefault = false;
    }

    isUseDefault() {
        return this.useDefault;
    }

    update(val) {
        if (this.numToSkip > 0) {
            this.numToSkip -= 1;
            return;
        }

        if (this.useDefault) {
            return;
        }

        if (typeof val !== 'undefined') {
            this.myGain = val;
        }

        this.contentLoudness = Math.round(this.myGain * this.basicGain * 100);
        this.numToSkip += 1;
        console.log(\`[Normalizer] Volume: \$\{this.contentLoudness\}%\`);
    }

}


class AudioGraph {
    constructor(videoEle) {
        this.audioCtx = new AudioContext();

        this.limiterNode = this.audioCtx.createDynamicsCompressor();
        this.limiterNode.threshold.value = 0;
        this.limiterNode.knee.value = 0;
        this.limiterNode.ratio.value = 20.0;
        this.limiterNode.attack.value = 0.001;
        this.limiterNode.release.value = 0.1;

        this.gainNode = this.audioCtx.createGain();
        this.gainNode.gain.value = 1.0;

        this.videoEleSource = this.audioCtx.createMediaElementSource(videoEle);
        this.videoEleSource.connect(this.audioCtx.destination);

        this.limiterNode.connect(this.gainNode);
    }

    set(dB) {
        const ratio = this.limiterNode.ratio.value;
        this.limiterNode.threshold.value = ratio / (ratio - 1.0) * dB;
        this.gainNode.gain.value = Math.pow(10, -0.4 * dB / 20);
    }

    connect() {
        this.videoEleSource.disconnect();
        this.videoEleSource.connect(this.limiterNode);
        this.gainNode.connect(this.audioCtx.destination);
    }

    disconnect() {
        this.gainNode.disconnect();
        this.videoEleSource.disconnect();
        this.videoEleSource.connect(this.audioCtx.destination);
    }
}

function updateVolume(audioGraph, testClass) {
    console.log('[Normalizer] New video');
    testClass.refresh();
    const dB = testClass.getDb();
    console.log(\`[Normalizer] Average volume: \$\{dB\}dB\`);
    if (dB >= 0) {
        console.log('[Normalizer] No amplification needed');
        if (!testClass.isUseDefault()) {
            console.log('[Normalizer] Disconnecting audio graph');
            audioGraph.disconnect();
            testClass.setUseDefault();
        }
    } else {
        audioGraph.set(dB);
        if (testClass.isUseDefault()) {
            console.log('[Normalizer] Connecting audio graph');
            audioGraph.connect();
            testClass.unsetUseDefault();
        }
        const actualGain = Math.pow(10, -dB / 20);
        testClass.update(actualGain);
        console.log(\`[Normalizer] Gain: \$\{-dB\}dB (\$\{actualGain * 100\}%)\`);
    }
}

function amplify(videoEle, testClass) {
    var audioGraph = new AudioGraph(videoEle);
    updateVolume(audioGraph, testClass);
    const observer = new MutationObserver(mutations => {
        updateVolume(audioGraph, testClass);
    });
    observer.observe(videoEle, {
        attributeFilter: ['src',],
    });
}

function checkApi(mp) {
    var ytPlayer = mp.getPlayerResponse();
    if (ytPlayer && ytPlayer.playerConfig && ytPlayer.playerConfig.audioConfig) {
        return ytPlayer.playerConfig.audioConfig.loudnessDb;
    } else {
        return null;
    }
}


(async function () {
    if (window.self !== window.top) {
        console.log("[Normalizer] load");
        var moviePlayer = await waitForElem("#movie_player", document);
        var videoElem = await waitForElem(".html5-main-video", document);
        if (moviePlayer && videoElem) {
            var db = await waitForFunc(checkApi, moviePlayer);
            console.log(\`[Normalizer] Content loudness: \$\{db\}\`);
            var testClass = new TestClass();
            await testClass.init(moviePlayer);
            amplify(videoElem, testClass);
        } else {
            return;
        }
    }
})();
`;
    var scriptElem = document.createElement('script');
    scriptElem.id = 'ytnorm';
    scriptElem.textContent = inline_script;
    document.body.appendChild(scriptElem);
}

(function() {
    'use strict';
    if (window.location.href.includes('youtube.com') || window.location.href.includes('youtube-nocookie.com') && window.location.href.includes('/embed/')) {
        if (window.self !== window.top) {
            writer();
        }
    } else {
        return;
    }
})();