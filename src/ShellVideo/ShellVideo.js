var EventEmitter = require('eventemitter3');
var cloneDeep = require('lodash.clonedeep');
var deepFreeze = require('deep-freeze');
var ERROR = require('../error');

var playerProps = [
    'paused',
    'muted',
    'volume',
    'duration',
    'time',
    'subtitlesTracks',
    'selectedSubtitlesTrackId',
    'audioTracks',
    'selectedAudioTrackId',
];

function ShellVideo(options) {
    options = options || {};

    var shellTransport = options.shellTransport;
    if (!shellTransport) {
        throw new Error('Shell transport required');
    }

    playerProps.forEach(function(name) {
        shellTransport.on(name, function() {
            onPropChanged(name);
        });
    });

    var events = new EventEmitter();
    var destroyed = false;
    var stream = null;
    var observedProps = {
        stream: true,
        paused: true,
        muted: true,
        volume: true,
        duration: true,
        time: true,
        subtitlesTracks: true,
        selectedSubtitlesTrackId: true,
        audioTracks: true,
        selectedAudioTrackId: true,
    };

    function getProp(propName) {
        switch (propName) {
            case 'stream': {
                return stream;
            }
            case 'paused': {
                if (destroyed || typeof shellTransport.state.paused !== 'boolean') {
                    return null;
                }

                return !!shellTransport.state.paused;
            }
            case 'muted': {
                if (destroyed || typeof shellTransport.state.muted !== 'boolean') {
                    return null;
                }

                return !!shellTransport.state.muted;
            }
            case 'volume': {
                if (destroyed || typeof shellTransport.state.volume !== 'number' || !isFinite(shellTransport.state.volume)) {
                    return null;
                }

                return Math.floor(shellTransport.state.volume);
            }
            case 'duration': {
                if (destroyed || typeof shellTransport.state.duration !== 'number' || !isFinite(shellTransport.state.duration)) {
                    return null;
                }

                return Math.floor(shellTransport.state.duration);
            }
            case 'time': {
                if (destroyed || typeof shellTransport.state.time !== 'number' || !isFinite(shellTransport.state.time)) {
                    return null;
                }

                return Math.floor(shellTransport.state.time);
            }
            case 'subtitlesTracks': {
                if (destroyed || !Array.isArray(shellTransport.state.subtitlesTracks)) {
                    return [];
                }

                return Array.from(shellTransport.state.subtitlesTracks)
                    .map(function (track, index) {
                        return Object.freeze({
                            id: 'EMBEDDED_' + String(index),
                            lang: track.language,
                            label: track.label,
                            origin: 'EMBEDDED',
                            embedded: true
                        });
                    });
            }
            case 'selectedSubtitlesTrackId': {
                if (destroyed || typeof shellTransport.state.selectedSubtitlesTrack !== 'number') {
                    return null;
                }

                return 'EMBEDDED_' + String(shellTransport.state.selectedSubtitlesTrack);
            }
            case 'audioTracks': {
                if (destroyed || !Array.isArray(shellTransport.state.audioTracks)) {
                    return [];
                }

                return Array.from(shellTransport.state.audioTracks)
                    .map(function (track, index) {
                        return Object.freeze({
                            id: 'EMBEDDED_' + String(index),
                            lang: track.language,
                            label: track.label,
                            origin: 'EMBEDDED',
                            embedded: true
                        });
                    });
            }
            case 'selectedAudioTrackId': {
                if (destroyed || typeof shellTransport.state.selectedAudioTrack !== 'number') {
                    return null;
                }

                return 'EMBEDDED_' + String(shellTransport.state.selectedAudioTrack);
            }
            default: {
                return null;
            }
        }
    }

    function onError(error) {
        events.emit('error', error);
        if (error.critical) {
            command('unload');
        }
    }

    function onPropChanged(propName) {
        if (observedProps[propName]) {
            events.emit('propChanged', propName, getProp(propName));
        }
    }

    function observeProp(propName) {
        if (observedProps.hasOwnProperty(propName)) {
            events.emit('propValue', propName, getProp(propName));
            observedProps[propName] = true;
        }
    }

    function setProp(propName, propValue) {
        switch (propName) {
            case 'paused': {
                if (stream !== null) {
                    propValue ? shellTransport.send('pause') : shellTransport.send('play');
                }

                break;
            }
            case 'volume': {
                if (propValue !== null && isFinite(propValue)) {
                    shellTransport.send('volume', Math.max(0, Math.min(100, parseInt(propValue, 10))));
                }

                break;
            }
            case 'muted': {
                propValue ? shellTransport.send('mute') : shellTransport.send('unmute');
                break;
            }
            case 'time': {
                if (propValue !== null && isFinite(propValue)) {
                    shellTransport.send('time', parseInt(propValue, 10));
                }

                break;
            }
            case 'selectedSubtitlesTrackId': {
                if (propValue !== null && typeof propValue === 'string') {
                    var subtitlesTrackId = getProp('subtitlesTracks')
                        .map(function (track) { return track.id; })
                        .indexOf(propValue);

                    subtitlesTrackId && shellTransport.send('subtitlesTrack', subtitlesTrackId);
                }

                break;
            }
            case 'selectedAudioTrackId': {
                if (propValue !== null && typeof propValue === 'string') {
                    var audioTrackId = getProp('audioTracks')
                        .map(function (track) { return track.id; })
                        .indexOf(propValue);

                    audioTrackId && shellTransport.send('audioTrack', audioTrackId);
                }

                break;
            }
        }
    }

    function command(commandName, commandArgs) {
        switch (commandName) {
            case 'load': {
                command('unload');
                if (commandArgs && commandArgs.stream && typeof commandArgs.stream.url === 'string') {
                    stream = commandArgs.stream;
                    shellTransport.send('load', commandArgs.stream.url);
                    onPropChanged('stream');
                } else {
                    onError(Object.assign({}, ERROR.UNSUPPORTED_STREAM, {
                        critical: true,
                        stream: commandArgs ? commandArgs.stream : null
                    }));
                }
                break;
            }
            case 'unload': {
                stream = null;
                onPropChanged('stream');
                shellTransport.send('unload');
                playerProps.forEach(onPropChanged);
                break;
            }
            case 'destroy': {
                command('unload');
                destroyed = true;
                playerProps.forEach(onPropChanged);
                events.removeAllListeners();
                break;
            }
        }
    }

    this.on = function(eventName, listener) {
        if (destroyed) {
            throw new Error('Video is destroyed');
        }

        events.on(eventName, listener);
    };

    this.dispatch = function(action) {
        if (destroyed) {
            throw new Error('Video is destroyed');
        }

        if (action) {
            action = deepFreeze(cloneDeep(action));
            switch (action.type) {
                case 'observeProp': {
                    observeProp(action.propName);
                    return;
                }
                case 'setProp': {
                    setProp(action.propName, action.propValue);
                    return;
                }
                case 'command': {
                    command(action.commandName, action.commandArgs);
                    return;
                }
            }
        }

        throw new Error('Invalid action dispatched: ' + JSON.stringify(action));
    };
}

ShellVideo.canPlayStream = function() {
    return Promise.resolve(true);
};

ShellVideo.manifest = {
    name: 'ShellVideo',
    external: true,
    props: ['stream'].concat(playerProps),
    commands: ['load', 'unload', 'destroy'],
    events: ['propValue', 'propChanged', 'ended', 'error'],
};

module.exports = ShellVideo;
