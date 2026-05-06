import './style.css';
import { supabase, createRoom, joinRoom, updateRoomState, subscribeToRoom, signInWithGoogle, signInWithPhone, verifyPhoneOtp, signOut, onAuthStateChanged } from './supabase.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

// ===== SUPABASE AUTH SETUP =====
let currentAuthUser = null;
let currentAuthUID = null;
let isGuestMode = true; // Default to guest mode - players can start without signing in
let phonePhoneNumber = null; // Store phone number for OTP verification

// Initialize auth listener when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAuth);
} else {
    initializeAuth();
}

function initializeAuth() {
    try {
        // Listen to auth state changes from Supabase
        onAuthStateChanged((user) => {
            if (user) {
                currentAuthUser = user;
                currentAuthUID = user.id; // Supabase uses 'id' instead of 'uid'
                isGuestMode = false;
                
                // Pre-fill myPlayerName from Google profile or metadata
                myPlayerName = user.user_metadata?.full_name || user.email?.split('@')[0] || user.phone || 'Player';
                
                console.log('✅ USER SIGNED IN - UID:', currentAuthUID, 'Name:', myPlayerName);
                closeAuthModal();
            } else {
                currentAuthUser = null;
                currentAuthUID = null;
                console.log('⚠️ User signed out or not authenticated - currentAuthUID set to null');
                // Stay in guest mode if not signed in
                isGuestMode = true;
            }
        });
        
        // Don't show auth modal on startup - let players start without signing in
        // They can click the Sign in button to authenticate if they want
    } catch (err) {
        console.error('Auth init error:', err);
    }
}

// Detect mobile
const isMobile = () => /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
const isPortrait = () => window.innerHeight > window.innerWidth;

// DOM Elements
const mainMenu = document.getElementById('main-menu');
const gameModeMenu = document.getElementById('game-mode-menu');
const multiplayerMenu = document.getElementById('multiplayer-menu');
const joinRoomPanel = document.getElementById('join-room-panel');
const playerSetupMenu = document.getElementById('player-setup-menu');
const gameContainer = document.getElementById('game-container');
const gameCanvas = document.getElementById('game-canvas');
const ctx = gameCanvas.getContext('2d');
const fullscreenBtn = document.getElementById('fullscreen-btn');
const exitFullscreenBtn = document.getElementById('exit-fullscreen-btn');

const startGameBtn = document.getElementById('start-game-btn');
const singlePlayerBtn = document.getElementById('single-player-btn');
const multiplayerBtn = document.getElementById('multiplayer-btn');
const playGameBtn = document.getElementById('play-game-btn');
const unoActionBtn = document.getElementById('uno-action-btn');
const catchUnoBtn = document.getElementById('catch-uno-btn');
const gameAlert = document.getElementById('game-alert');
const waitingRoomMenu = document.getElementById('waiting-room-menu');
const colorIndicatorGlow = document.getElementById('color-indicator');
const timerElement = document.getElementById('timer');
const currentPlayerNameHUD = document.getElementById('current-player-name');
const playerColorCircle = document.getElementById('player-color-circle');
const penaltyCounter = document.getElementById('penalty-counter');
const penaltyValue = document.getElementById('penalty-value');

const settingsTrigger = document.getElementById('settings-trigger-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettings = document.getElementById('close-settings-btn');
const exitToMenu = document.getElementById('exit-to-menu-btn');
const howToPlay = document.getElementById('how-to-play-btn');
const rulesView = document.getElementById('rules-view');

const gameOverModal = document.getElementById('game-over-modal');
const winnerNameDisplay = document.getElementById('winner-name');
const playAgainBtn = document.getElementById('play-again-btn');
const gameOverExitBtn = document.getElementById('game-over-exit-btn');

// Constants
let CARD_W = 80;
let opponentBounds = [];
let CARD_H = 120;
let SCALE = 1;
const CARD_R = 10;
const BOT_PLAY_DELAY = 1500;

// State
let game = null;
let gameRunning = false;
let menuBackground = null;
let myPlayerIndex = 0;
let isShuffling = false;
let cardImages = {};
let bgImage = null;
let hoveredCardIndex = -1;
let humanCardBounds = [];
let alertTimeout = null;
let handScrollX = 0;
let isMultiplayer = false;
let currentRoomCode = null;
let isHost = false;
let hostPlayerId = null;
let myPlayerId = null;
let lastSyncedState = null;
let isSyncing = false;
let colorChooserVisible = false;
let lastAutoPlayTime = 0; // FIX: Prevent multiple autoPlay calls in same turn
let deviceId = null; // Unique device identifier for player recognition
let chatMessages = []; // Store chat messages
let chatChannel = null; // Supabase realtime channel for chat
let myPlayerName = 'Guest'; // Store local player name for chat and UI
let unreadChatCount = 0; // Track unread messages for notification badge

// ===== AUTH MODAL FUNCTIONS =====
function showAuthModal() {
    const authModal = document.getElementById('auth-modal');
    const mainMenu = document.getElementById('main-menu');
    if (authModal) {
        authModal.classList.remove('hidden');
        if (mainMenu) mainMenu.classList.add('hidden');
    }
}

function closeAuthModal() {
    const authModal = document.getElementById('auth-modal');
    const mainMenu = document.getElementById('main-menu');
    if (authModal) {
        authModal.classList.add('hidden');
        if (mainMenu) mainMenu.classList.remove('hidden');
    }
}

function showAuthLoading(show = true) {
    const loading = document.getElementById('auth-loading');
    const buttons = document.getElementById('auth-buttons');
    if (loading) loading.classList.toggle('hidden', !show);
    if (buttons) buttons.classList.toggle('hidden', show);
}

// ===== DEVICE RECOGNITION SYSTEM =====
function getOrCreateDeviceId() {
    let id = localStorage.getItem('unoDeviceId');
    if (!id) {
        id = 'dev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('unoDeviceId', id);
    }
    return id;
}

function findPlayerByAuthUID(players, uid) {
    return players.find(p => p.authUID === uid);
}

// ===== MOBILE PERFORMANCE OPTIMIZATION =====
let lastDrawTime = 0;
let cachedGradient = null;
let lastCanvasW = 0;
let lastCanvasH = 0;
let isScrolling = false;
let scrollThrottleTimer = null;
const MOBILE_FRAME_RATE = 30; // Target 30 FPS on mobile for smooth scrolling
const DESKTOP_FRAME_RATE = 60; // 60 FPS on desktop

// ===== MULTIPLAYER DISCONNECT TRACKING =====
const RECONNECT_TIMEOUT_MS = 90000; // 1.5 minutes
let playerDisconnectTimers = {}; // { playerId: { startTime, timeout } }
let lastPlayerUpdateTimes = {}; // Track last update time for each player

// Fullscreen handling
function requestFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) elem.requestFullscreen().catch(() => {});
    else if (elem.webkitRequestFullscreen) elem.webkitRequestFullscreen();
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
    gameContainer.classList.add('fullscreen');
    if (fullscreenBtn) fullscreenBtn.classList.add('hidden');
    if (exitFullscreenBtn) exitFullscreenBtn.classList.remove('hidden');
}

function exitFullscreen() {
    if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    gameContainer.classList.remove('fullscreen');
    if (fullscreenBtn) fullscreenBtn.classList.remove('hidden');
    if (exitFullscreenBtn) exitFullscreenBtn.classList.add('hidden');
}

function showAlert(message) {
    if (!gameAlert) return;
    gameAlert.textContent = message;
    gameAlert.classList.remove('hidden', 'vis-hidden');
    if (typeof gsap !== 'undefined') {
        gsap.fromTo(gameAlert, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: "back.out" });
    }
    if (alertTimeout) clearTimeout(alertTimeout);
    alertTimeout = setTimeout(() => {
        if (typeof gsap !== 'undefined') {
            gsap.to(gameAlert, { opacity: 0, scale: 0.5, duration: 0.3, onComplete: () => gameAlert.classList.add('vis-hidden') });
        } else {
            gameAlert.classList.add('vis-hidden');
        }
    }, 3000);
}

// ===== MULTIPLAYER CHAT SYSTEM =====
function showChatBox() {
    const chatContainer = document.getElementById('chatbox-container');
    if (chatContainer) {
        chatContainer.classList.remove('hidden');
        // Reset unread count and hide badges
        unreadChatCount = 0;
        updateChatBadgeUI();
    }
}

function hideChatBox() {
    const chatContainer = document.getElementById('chatbox-container');
    if (chatContainer) chatContainer.classList.add('hidden');
    // Also hide emoji picker if it was open
    const picker = document.getElementById('chat-emoji-picker');
    if (picker) picker.classList.add('hidden');
}

function updateChatBadgeUI() {
    const hudBadge = document.getElementById('chat-badge-hud');
    const lobbyBadge = document.getElementById('chat-badge-lobby');
    
    if (unreadChatCount > 0) {
        if (hudBadge) { hudBadge.textContent = unreadChatCount > 9 ? '9+' : unreadChatCount; hudBadge.classList.remove('hidden'); }
        if (lobbyBadge) { lobbyBadge.textContent = unreadChatCount > 9 ? '9+' : unreadChatCount; lobbyBadge.classList.remove('hidden'); }
    } else {
        if (hudBadge) hudBadge.classList.add('hidden');
        if (lobbyBadge) lobbyBadge.classList.add('hidden');
    }
}

function addChatMessage(playerName, message) {
    const messagesDiv = document.getElementById('chat-messages');
    if (!messagesDiv) return;
    
    const msgElement = document.createElement('div');
    msgElement.style.cssText = `
        background: rgba(255, 182, 193, 0.1);
        border-left: 3px solid #FFB6C1;
        padding: 8px;
        border-radius: 4px;
        font-size: 0.9em;
        word-wrap: break-word;
    `;
    msgElement.innerHTML = `<strong style="color: #FFB6C1;">${playerName}:</strong> <span style="color: white;">${escapeHtml(message)}</span>`;
    messagesDiv.appendChild(msgElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function cleanupMultiplayer() {
    isMultiplayer = false;
    isHost = false;
    currentRoomCode = null;
    
    // Hide chat buttons
    const chatTriggerBtn = document.getElementById('chat-trigger-btn');
    const toggleChatBtn = document.getElementById('toggle-chat-btn');
    const chatContainer = document.getElementById('chatbox-container');
    
    if (chatTriggerBtn) chatTriggerBtn.classList.add('hidden');
    if (toggleChatBtn) toggleChatBtn.classList.add('hidden');
    if (chatContainer) chatContainer.classList.add('hidden');
    
    // Unsubscribe from chat channel
    if (chatChannel) {
        chatChannel.unsubscribe();
        chatChannel = null;
    }
    
    // Stop heartbeat
    stopHeartbeat();
}

function initializeChatSystem() {
    if (!isMultiplayer || !currentRoomCode) {
        console.log('Chat system: Not in multiplayer or no room code');
        return;
    }
    
    console.log('Initializing chat system for room:', currentRoomCode);
    
    // Setup chat trigger buttons visibility
    const chatTriggerBtn = document.getElementById('chat-trigger-btn');
    const toggleChatBtn = document.getElementById('toggle-chat-btn');
    
    if (chatTriggerBtn) {
        chatTriggerBtn.classList.remove('hidden');
    }
    if (toggleChatBtn) {
        toggleChatBtn.classList.remove('hidden');
    }

    // Cleanup previous channel if exists
    if (chatChannel) {
        chatChannel.unsubscribe();
    }
    
    // Subscribe to chat channel
    chatChannel = supabase.channel(`chat:${currentRoomCode}`);
    
    chatChannel
        .on('broadcast', { event: 'message' }, ({ payload }) => {
            console.log('Chat message received:', payload);
            if (payload && payload.player && payload.text) {
                addChatMessage(payload.player, payload.text);
                
                // If chatbox is closed, increment unread count and show badge
                const chatContainer = document.getElementById('chatbox-container');
                if (chatContainer && chatContainer.classList.contains('hidden')) {
                    unreadChatCount++;
                    updateChatBadgeUI();
                }
            }
        })
        .subscribe((status) => {
            console.log('Chat channel status:', status);
        });
    
    // Remove any previous listeners to prevent duplicates
    const closeBtn = document.getElementById('close-chat-btn');
    const sendBtn = document.getElementById('send-chat-btn');
    const chatInput = document.getElementById('chat-input');
    
    // Setup chat trigger button
    if (chatTriggerBtn) {
        const newBtn = chatTriggerBtn.cloneNode(true);
        chatTriggerBtn.parentNode.replaceChild(newBtn, chatTriggerBtn);
        newBtn.addEventListener('click', () => {
            showChatBox();
            console.log('Chat box opened via HUD');
        });
    }

    // Setup toggle chat button (lobby/fixed)
    if (toggleChatBtn) {
        const newToggleBtn = toggleChatBtn.cloneNode(true);
        toggleChatBtn.parentNode.replaceChild(newToggleBtn, toggleChatBtn);
        newToggleBtn.addEventListener('click', () => {
            showChatBox();
            console.log('Chat box opened via Toggle');
        });
    }
    
    if (closeBtn) {
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
        newCloseBtn.addEventListener('click', hideChatBox);
    }

    // Setup Emoji Picker
    const emojiBtn = document.getElementById('chat-emoji-btn');
    const emojiPicker = document.getElementById('chat-emoji-picker');
    if (emojiBtn && emojiPicker) {
        const newEmojiBtn = emojiBtn.cloneNode(true);
        emojiBtn.parentNode.replaceChild(newEmojiBtn, emojiBtn);
        newEmojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            emojiPicker.classList.toggle('hidden');
        });
        
        // Hide picker when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!emojiPicker.classList.contains('hidden') && !emojiPicker.contains(e.target) && e.target !== newEmojiBtn) {
                emojiPicker.classList.add('hidden');
            }
        });
    }

    // Emoji options
    document.querySelectorAll('.chat-emoji-opt').forEach(opt => {
        const newOpt = opt.cloneNode(true);
        opt.parentNode.replaceChild(newOpt, opt);
        newOpt.addEventListener('click', (e) => {
            const input = document.getElementById('chat-input');
            if (input) {
                input.value += newOpt.textContent;
                input.focus();
            }
        });
    });
    
    if (sendBtn) {
        const newSendBtn = sendBtn.cloneNode(true);
        sendBtn.parentNode.replaceChild(newSendBtn, sendBtn);
        newSendBtn.addEventListener('click', async () => {
            const message = chatInput.value.trim();
            if (message && currentRoomCode) {
                const playerName = myPlayerName || 'Unknown';
                
                console.log('Sending message:', message, 'from:', playerName);
                
                // Broadcast to others
                if (chatChannel) {
                    await chatChannel.send({
                        type: 'broadcast',
                        event: 'message',
                        payload: { player: playerName, text: message }
                    });
                }
                
                addChatMessage(playerName, message);
                chatInput.value = '';
            } else {
                console.log('Cannot send message - missing room code or empty message');
            }
        });
    }
    
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const sendBtn = document.getElementById('send-chat-btn');
                if (sendBtn) sendBtn.click();
            }
        });
    }
}

// Notify player of reconnection attempt
function notifyReconnectionAttempt(playerName, timeRemaining) {
    const mins = Math.floor(timeRemaining / 60000);
    const secs = Math.floor((timeRemaining % 60000) / 1000);
    showAlert(`⏳ ${playerName} reconnecting... ${mins}:${String(secs).padStart(2, '0')}`);
}

// Remove disconnected player from game
function removeDisconnectedPlayer(playerId) {
    if (!game || !game.players) return;
    const playerIdx = game.players.findIndex(p => p.id === playerId);
    if (playerIdx === -1) return;
    
    const player = game.players[playerIdx];
    player.eliminated = true;
    showAlert(`❌ ${player.name} disconnected and was removed from the game.`);
    
    // Adjust current player index if needed
    if (game.currentPlayerIndex >= game.players.length || game.players[game.currentPlayerIndex]?.eliminated) {
        game.nextTurn();
    }
    
    // Clear disconnect timer
    if (playerDisconnectTimers[playerId]) {
        clearTimeout(playerDisconnectTimers[playerId].timeout);
        delete playerDisconnectTimers[playerId];
    }
    
    // Sync state to all players
    if (isMultiplayer) game.syncState();
}

function updateColorGlow(color) {
    if (!colorIndicatorGlow) return;
    const colors = { red: '#ff1744', blue: '#2979ff', green: '#00e676', yellow: '#ffea00', none: 'transparent' };
    colorIndicatorGlow.style.background = colors[color] || 'transparent';
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    gameCanvas.width = window.innerWidth * dpr;
    gameCanvas.height = window.innerHeight * dpr;
    gameCanvas.style.width = `${window.innerWidth}px`;
    gameCanvas.style.height = `${window.innerHeight}px`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const baseW = 1440, baseH = 900;
    SCALE = Math.min(window.innerWidth / baseW, window.innerHeight / baseH);
    // Mobile scaling adjustments
    if (isMobile() && isPortrait()) {
        SCALE = Math.min(window.innerWidth / 390, window.innerHeight / 844) * 0.85;
    } else if (isMobile() && !isPortrait()) {
        // Zoom out more in landscape to fit up to 6 players comfortably without overlap
        SCALE = Math.min(window.innerWidth / 844, window.innerHeight / 390) * 0.55;
    }
    SCALE = Math.max(0.35, Math.min(SCALE, 1.2));
    SCALE *= dpr; // Apply physical pixel scaling
    CARD_W = 80 * SCALE;
    CARD_H = 120 * SCALE;
}
resizeCanvas();
window.addEventListener('resize', () => { resizeCanvas(); if (gameRunning) draw(); });

// ===== CARD CLASS =====
class Card {
    constructor(color, value, filename) {
        this.color = color;
        this.value = value;
        this.filename = filename;
    }
}

// ===== PLAYER CLASS =====
class Player {
    constructor(name, emoji = '👤', isBot = false, id = null, isHost = false, deviceId = null, authUID = null) {
        this.name = name;
        this.emoji = emoji;
        this.hand = [];
        this.isBot = isBot;
        this.id = id || 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.eliminated = false;
        this.unoCalled = false;
        this.isHost = isHost;
        this.deviceId = deviceId || null; // Track device for player recognition
        this.authUID = authUID || null; // Track authenticated user UID
    }
    addCard(card) {
        if (!card || this.eliminated) return;
        this.hand.push(card);
    }
    playCard(index) { return this.hand.splice(index, 1)[0]; }
}

// ===== MENU BACKGROUND =====
class MenuBackground {
    constructor() {
        this.container = document.getElementById('bg-3d-container');
        this.overlay = document.getElementById('menu-glass-overlay');
        if (!this.container) return;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(0, 0, 5);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);
        this.clock = new THREE.Clock();
        this.mixer = null;
        this.model = null;
        this.initLights();
        this.loadModel();
        this.animate();
        window.addEventListener('resize', () => this.onResize());
    }
    initLights() {
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const pl = new THREE.PointLight(0xffffff, 1);
        pl.position.set(5, 5, 5);
        this.scene.add(pl);
    }
    loadModel() {
        const loader = new GLTFLoader();
        loader.load('uno.glb', (gltf) => {
            this.model = gltf.scene;
            const box = new THREE.Box3().setFromObject(this.model);
            const size = box.getSize(new THREE.Vector3());
            const scale = 3.5 / Math.max(size.x, size.y, size.z);
            this.model.scale.set(scale, scale, scale);
            this.scene.add(this.model);
            if (gltf.animations && gltf.animations.length > 0) {
                this.mixer = new THREE.AnimationMixer(this.model);
                const action = this.mixer.clipAction(gltf.animations.find(a => a.name === 'Animation') || gltf.animations[0]);
                action.play();
            }
        });
    }
    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    hide() {
        if (typeof gsap !== 'undefined') {
            gsap.to(this.container, { opacity: 0, duration: 1, onComplete: () => this.container.style.display = 'none' });
        } else {
            this.container.style.display = 'none';
        }
        if (this.overlay) this.overlay.classList.add('hidden');
    }
    show() {
        this.container.style.display = 'block';
        if (typeof gsap !== 'undefined') gsap.to(this.container, { opacity: 1, duration: 1 });
        if (this.overlay) this.overlay.classList.remove('hidden');
    }
    animate() {
        requestAnimationFrame(() => this.animate());
        const delta = this.clock.getDelta();
        if (this.mixer) this.mixer.update(delta);
        if (this.model) {
            this.model.rotation.y += delta * 0.2;
            this.model.rotation.x = Math.sin(this.clock.elapsedTime) * 0.1;
        }
        this.renderer.render(this.scene, this.camera);
    }
}

// ===== UNO GAME CLASS =====
class UNOGame {
    constructor(playerConfigs, scores = {}) {
        this.players = playerConfigs.map(cfg => new Player(cfg.name, cfg.emoji, cfg.isBot, cfg.id, cfg.isHost || false, cfg.deviceId || null, cfg.authUID || null));
        this.deck = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.gameDirection = 1;
        this.gameOver = false;
        this.turnTimer = 20;
        this.turnStartTime = Date.now();
        this.stackPenalty = 0;
        this.chosenColor = 'none';
        this.waitingForColor = false;
        this.waitingForSwap = false;
        this.lastAlert = null;
        this.lastAlertTime = 0;
        this.scores = scores;
        this.lastPlayedPlayerIndex = null;
        this.hasDrawnThisTurn = false;
        this.drawnCardIndexThisTurn = -1;
        this.nextRoundReadySet = {};
        this.createDeck();
        this.shuffleDeck();
        this.startDiscardPile();
        this.dealInitial();
    }

    createDeck() {
        const colors = ['blue', 'green', 'red', 'yellow'];
        const numbers = ['0','1','2','3','4','5','6','7','8','9'];
        colors.forEach(color => {
            this.deck.push(new Card(color, '0', `${color}0.png`));
            numbers.slice(1).forEach(n => {
                this.deck.push(new Card(color, n, `${color}${n}.png`));
                this.deck.push(new Card(color, n, `${color}${n}.png`));
            });
            this.deck.push(new Card(color, 'skip', `${color}block.png`));
            this.deck.push(new Card(color, 'skip', `${color}block.png`));
            const rev = (color==='red'||color==='yellow') ? 'revrese.png' : 'reverse.png';
            this.deck.push(new Card(color, 'reverse', `${color}${rev}`));
            this.deck.push(new Card(color, 'reverse', `${color}${rev}`));
            const d2 = (color==='blue'||color==='green') ? '+2.png' : '2+.png';
            this.deck.push(new Card(color, 'draw_2', `${color}${d2}`));
            this.deck.push(new Card(color, 'draw_2', `${color}${d2}`));
            this.deck.push(new Card(color, 'draw_4', `${color}4+.png`));
            this.deck.push(new Card(color, 'draw_4', `${color}4+.png`));
            this.deck.push(new Card(color, 'skip_all', `${color}skipall.png`));
            this.deck.push(new Card(color, 'discard_all', `discardall${color}.png`));
        });
        for (let i = 0; i < 4; i++) {
            this.deck.push(new Card('wild', 'wild', 'colorchange.png'));
            this.deck.push(new Card('wild', 'reverse_draw_4', 'reverse4+.png'));
            this.deck.push(new Card('wild', 'wild_draw_6', '+6.png'));
            this.deck.push(new Card('wild', 'wild_draw_10', '+10.png'));
        }
    }

    shuffleDeck() {
        for (let i = this.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
        }
    }

    startDiscardPile() {
        let card = this.deck.pop();
        while (card.color === 'wild' || this.getCardPenalty(card) > 0 || ['skip','reverse','skip_all','discard_all'].includes(card.value)) {
            this.deck.unshift(card);
            card = this.deck.pop();
        }
        this.discardPile.push(card);
        this.chosenColor = card.color;
        updateColorGlow(this.chosenColor);
    }

    dealInitial() {
        for (let i = 0; i < 7; i++) this.players.forEach(p => p.addCard(this.safeDraw()));
    }

    safeDraw() {
        if (this.deck.length === 0) {
            const top = this.discardPile.pop();
            this.deck = [...this.discardPile];
            this.discardPile = [top];
            this.shuffleDeck();
        }
        return this.deck.pop();
    }

    getCurrentPlayer() { return this.players[this.currentPlayerIndex]; }
    getTopCard() { return this.discardPile[this.discardPile.length - 1]; }

    getCardPenalty(card) {
        if (card.value === 'draw_2') return 2;
        if (card.value === 'draw_4' || card.value === 'reverse_draw_4') return 4;
        if (card.value === 'wild_draw_6') return 6;
        if (card.value === 'wild_draw_10') return 10;
        return 0;
    }

    isValidMove(card, index = -1, pIdx = this.currentPlayerIndex) {
        const player = this.players[pIdx] || this.getCurrentPlayer();
        if (!card || !player) return false;
        if (this.hasDrawnThisTurn && index !== -1 && index !== this.drawnCardIndexThisTurn) return false;
        if (player.hand.length === 1) {
            const finalCardBlocked = card.color === 'wild' || ['draw_4', 'reverse_draw_4', 'wild_draw_6', 'wild_draw_10', '7', '0'].includes(card.value);
            if (finalCardBlocked) return false;
        }
        const top = this.getTopCard();
        if (this.stackPenalty > 0) {
            const p = this.getCardPenalty(card);
            return p > 0 && p >= this.getCardPenalty(top);
        }
        if (card.color === 'wild') return true;
        return card.color === this.chosenColor || card.value === top.value;
    }

    playCard(pIdx, cIdx, isBot = false) {
        const player = this.players[pIdx];
        if (!player || cIdx < 0 || cIdx >= player.hand.length) return;
        const card = player.playCard(cIdx);
        this.lastPlayedPlayerIndex = pIdx;
        this.discardPile.push(card);
        this.hasDrawnThisTurn = false;
        this.drawnCardIndexThisTurn = -1;
        // FIX: Reset autoPlay timer when a card is played
        lastAutoPlayTime = 0;

        if (card.color === 'wild') {
            if (isBot) {
                const botColors = player.hand.reduce((acc, c) => {
                    if (c.color !== 'wild') acc[c.color] = (acc[c.color] || 0) + 1;
                    return acc;
                }, {});
                const preferred = Object.entries(botColors).sort((a, b) => b[1] - a[1])[0];
                this.chosenColor = preferred ? preferred[0] : ['red','blue','green','yellow'][Math.floor(Math.random()*4)];
                updateColorGlow(this.chosenColor);
                this.finishTurn(pIdx, player);
            } else {
                this.waitingForColor = true;
                colorChooserVisible = true;
                showColorChooser();
                this.syncState();
            }
            return;
        } else {
            this.chosenColor = card.color;
            updateColorGlow(this.chosenColor);

            if (card.value === '7') {
                if (isBot) {
                    const actives = this.players.filter(p => !p.eliminated && p !== this.players[pIdx]);
                    if (actives.length > 0) {
                        const target = actives.reduce((prev, curr) => prev.hand.length < curr.hand.length ? prev : curr);
                        this.swapHands(pIdx, this.players.indexOf(target));
                    }
                } else {
                    this.waitingForSwap = true;
                    this.broadcastAlert(`${player.name.toUpperCase()} IS CHOOSING WHO TO SWAP WITH!`);
                    this.syncState();
                    return; // Delay finishTurn
                }
            }
        }
        this.finishTurn(pIdx, player);
    }

    finishTurn(pIdx, player) {
        if (player.hand.length > 1) player.unoCalled = false;
        this.applyEffect(this.getTopCard(), pIdx);
        this.checkWin();
        if (!this.gameOver) this.nextTurn();
        this.syncState();
    }

    applyEffect(card, pIdx) {
        const pVal = this.getCardPenalty(card);
        if (pVal > 0) {
            this.stackPenalty += pVal;
            if (card.value === 'reverse_draw_4') this.gameDirection *= -1;
            return;
        }
        if (card.value === 'skip') this.advanceIndex();
        else if (card.value === 'reverse') {
            if (this.players.filter(p => !p.eliminated).length === 2) this.advanceIndex();
            else this.gameDirection *= -1;
        } else if (card.value === 'skip_all') {
            const active = this.players.filter(p => !p.eliminated).length;
            for (let i = 0; i < active - 1; i++) this.advanceIndex();
        } else if (card.value === 'discard_all') {
            const p = this.players[pIdx];
            for (let i = p.hand.length - 1; i >= 0; i--) {
                if (p.hand[i].color === card.color) this.discardPile.push(p.hand.splice(i, 1)[0]);
            }
        } else if (card.value === '0') {
            // UNO No Mercy Rule: 0 card passes all hands in the direction of play
            const actives = this.players.filter(p => !p.eliminated);
            if (actives.length > 1) {
                const hands = actives.map(p => p.hand);
                if (this.gameDirection === 1) {
                    const last = hands.pop();
                    hands.unshift(last);
                } else {
                    const first = hands.shift();
                    hands.push(first);
                }
                actives.forEach((p, i) => { p.hand = hands[i]; p.unoCalled = false; });
                this.broadcastAlert(`${this.players[pIdx].name.toUpperCase()} PLAYED A 0! HANDS ROTATED!`);
            }
        } else if (card.value === '7') {
            // Handled in playCard and swapHands
        }
    }

    swapHands(pIdx1, pIdx2) {
        const temp = this.players[pIdx1].hand;
        this.players[pIdx1].hand = this.players[pIdx2].hand;
        this.players[pIdx2].hand = temp;
        this.players[pIdx1].unoCalled = false;
        this.players[pIdx2].unoCalled = false;
        this.broadcastAlert(`${this.players[pIdx1].name.toUpperCase()} SWAPPED HANDS WITH ${this.players[pIdx2].name.toUpperCase()}!`);
    }

    eliminatePlayer(pIdx, eliminatorIdx) {
        const p = this.players[pIdx];
        if (p.eliminated) return;
        p.eliminated = true;
        p.hand = [];
        this.broadcastAlert(`${p.name.toUpperCase()} ELIMINATED (25+ CARDS)!`);
    }

    takePenalty() {
        const p = this.getCurrentPlayer();
        const drawAmount = this.stackPenalty;
        this.stackPenalty = 0;
        for (let i = 0; i < drawAmount; i++) {
            p.addCard(this.safeDraw());
            if (p.hand.length >= 25) {
                this.eliminatePlayer(this.currentPlayerIndex, this.lastPlayedPlayerIndex);
                break;
            }
        }
        this.checkWin();
        if (!this.gameOver) this.nextTurn();
        this.syncState();
    }

    drawCard() {
        const p = this.getCurrentPlayer();
        if (this.stackPenalty > 0) { this.takePenalty(); return; }
        
        let drawnCount = 0;
        
        // Draw only ONE card
        const c = this.safeDraw();
        if (c) {
            p.addCard(c);
            drawnCount++;
            if (p.hand.length >= 25) {
                this.eliminatePlayer(this.currentPlayerIndex, this.lastPlayedPlayerIndex);
            }
        }
        
        if (drawnCount > 0) this.broadcastAlert(`${p.name.toUpperCase()} DREW A CARD!`);
        
        if (p.eliminated) {
            this.checkWin();
            if (!this.gameOver) this.nextTurn();
            this.syncState();
            return;
        }

        if (p.isBot) {
            if (c && this.isValidMove(c)) {
                const idx = p.hand.indexOf(c);
                if (idx !== -1) {
                    this.playCard(this.currentPlayerIndex, idx, true);
                    return;
                }
            }
            this.nextTurn();
        } else {
            // Human player
            if (c && this.isValidMove(c)) {
                this.hasDrawnThisTurn = true;
                this.drawnCardIndexThisTurn = p.hand.length - 1;
            } else {
                this.nextTurn();
            }
        }
        this.syncState();
    }

    advanceIndex() {
        let iterations = 0;
        const maxIterations = this.players.length + 1;
        do {
            this.currentPlayerIndex = (this.currentPlayerIndex + this.gameDirection + this.players.length * 10) % this.players.length;
            iterations++;
            // FIX: Prevent infinite loop if all players are eliminated
            if (iterations > maxIterations) {
                console.warn("WARNING: advanceIndex loop detected, breaking");
                break;
            }
        } while (this.players[this.currentPlayerIndex].eliminated);
    }

    nextTurn() {
        this.advanceIndex();
        this.turnStartTime = Date.now();
        this.turnTimer = 20;
        this.hasDrawnThisTurn = false;
        this.drawnCardIndexThisTurn = -1;
        // FIX: Reset autoPlay timer when turn changes
        lastAutoPlayTime = 0;
        const currentP = this.getCurrentPlayer();
        if (currentP && currentP.isBot && !this.gameOver) {
            setTimeout(() => {
                if (game && this.currentPlayerIndex === this.players.indexOf(currentP)) executeBotTurn();
            }, BOT_PLAY_DELAY);
        }
    }

    autoPlay() {
        if (this.gameOver) return;
        const p = this.getCurrentPlayer();
        const validIndices = [];
        p.hand.forEach((c, idx) => { if (this.isValidMove(c)) validIndices.push(idx); });
        if (validIndices.length > 0) {
            this.playCard(this.currentPlayerIndex, validIndices[Math.floor(Math.random() * validIndices.length)], p.isBot);
        } else {
            this.drawCard();
        }
    }

    checkWin() {
        const actives = this.players.filter(p => !p.eliminated);
        if (actives.length === 1) { this.endGame(actives[0]); return; }
        for (const p of actives) if (p.hand.length === 0) { this.endGame(p); return; }
    }

    endGame(winner) {
        this.gameOver = true;
        
        // Tally points based on cards remaining in opponents' hands
        let roundPoints = 0;
        this.players.forEach(p => {
            if (p.id !== winner.id) {
                p.hand.forEach(c => {
                    if (c.color === 'wild') roundPoints += 50;
                    else if (['skip', 'reverse', 'draw_2', 'skip_all', 'discard_all'].includes(c.value)) roundPoints += 20;
                    else if (['draw_4', 'reverse_draw_4', 'wild_draw_6', 'wild_draw_10'].includes(c.value)) roundPoints += 50;
                    else if (!isNaN(parseInt(c.value))) roundPoints += parseInt(c.value);
                });
            }
        });
        this.scores[winner.id] = (this.scores[winner.id] || 0) + roundPoints;
        
        const isChampion = this.scores[winner.id] >= 1000;
        
        winnerNameDisplay.textContent = isChampion ? `${winner.name.toUpperCase()} IS THE CHAMPION!` : `${winner.name.toUpperCase()} WINS THE ROUND!`;
        document.getElementById('game-over-subtitle').textContent = `Total Points: ${this.scores[winner.id]} / 1000`;
        
        const scoreList = document.getElementById('scoreboard-list');
        if (scoreList) {
            // FIX: Show ranked standings with crown and medals for champion
            const standings = getStandings(this.players, this.scores);
            scoreList.innerHTML = standings.map((p, idx) => {
                const medal = getMedalEmoji(idx + 1);
                const crown = idx === 0 && isChampion ? ' 👑' : '';
                const bgColor = idx === 0 ? 'rgba(255, 215, 0, 0.12)' : idx === 1 ? 'rgba(192, 192, 192, 0.08)' : idx === 2 ? 'rgba(205, 127, 50, 0.08)' : 'transparent';
                const borderColor = idx === 0 ? 'rgba(255, 215, 0, 0.4)' : idx === 1 ? 'rgba(192, 192, 192, 0.25)' : idx === 2 ? 'rgba(205, 127, 50, 0.25)' : 'rgba(255,255,255,0.1)';
                return `<div style="display:flex; justify-content:space-between; align-items:center; padding:14px 10px; gap:12px; margin:6px 0; border-radius:8px; background:${bgColor}; border:1px solid ${borderColor}; box-shadow:${idx === 0 ? '0 4px 12px rgba(255, 215, 0, 0.15)' : 'none'}; transition:all 0.3s ease;">
                    <span style="display:flex; align-items:center; gap:10px; flex:1; font-weight:600;">
                        <span style="font-size:1.3em;">${medal}</span>
                        <span style="font-size:1.1em;">${p.emoji}</span>
                        <span style="color:${idx === 0 ? '#FFD700' : 'inherit'};">${p.name.toUpperCase()}${crown}</span>
                    </span>
                    <strong style="color:${idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : 'rgba(255,255,255,0.9)'}; font-size:1.1em;">${p.score} PTS</strong>
                </div>`;
            }).join('');
        }
        
        const nextBtn = document.getElementById('play-again-btn');
        if (nextBtn) {
            if (isChampion) {
                nextBtn.style.display = 'none';  // Hide Next Round button when champion
            } else {
                nextBtn.style.display = 'block';
                nextBtn.textContent = "Next Round";
            }
        }
        
        setTimeout(() => {
            gameOverModal.classList.remove('hidden');
            // Sync final scores and gameOver state to all players
            if (isMultiplayer) this.syncState();
        }, 1000);
    }

    updateTimer() {
        const elapsed = (Date.now() - this.turnStartTime) / 1000;
        this.turnTimer = Math.max(0, 20 - Math.floor(elapsed));
    }

    serialize() {
        return {
             players: this.players.map(p => ({
                name: p.name, emoji: p.emoji, isBot: p.isBot,
                hand: p.hand.map(c => ({ color: c.color, value: c.value, filename: c.filename })),
                eliminated: p.eliminated, unoCalled: p.unoCalled, id: p.id, isHost: p.isHost || false,
                authUID: p.authUID || null, deviceId: p.deviceId || null,
                disconnected: p.disconnected || false
            })),
            deck: this.deck.map(c => ({ color: c.color, value: c.value, filename: c.filename })),
            discardPile: this.discardPile.map(c => ({ color: c.color, value: c.value, filename: c.filename })),
            currentPlayerIndex: this.currentPlayerIndex,
            gameDirection: this.gameDirection,
            chosenColor: this.chosenColor,
            stackPenalty: this.stackPenalty,
            gameOver: this.gameOver,
            waitingForColor: this.waitingForColor,
            waitingForSwap: this.waitingForSwap,
            waitingPlayerId: (this.waitingForColor || this.waitingForSwap) ? (this.players[this.currentPlayerIndex]?.id || null) : null,
            lastAlert: this.lastAlert,
            lastAlertTime: this.lastAlertTime,
            scores: this.scores,
            lastPlayedPlayerIndex: this.lastPlayedPlayerIndex,
            hasDrawnThisTurn: this.hasDrawnThisTurn,
            drawnCardIndexThisTurn: this.drawnCardIndexThisTurn,
            nextRoundReadySet: { ...this.nextRoundReadySet },
            gameStarted: true,
            lastUpdate: Date.now()
        };
    }

    broadcastAlert(message) {
        showAlert(message);
        this.lastAlert = message;
        this.lastAlertTime = Date.now();
    }

    async syncState() {
        if (isMultiplayer && currentRoomCode) {
            if (isSyncing) return;
            isSyncing = true;
            try {
                await updateRoomState(currentRoomCode, this.serialize());
            } catch (err) {
                console.error("Sync failed:", err);
                setTimeout(() => updateRoomState(currentRoomCode, this.serialize()), 500);
            } finally {
                isSyncing = false;
            }
        }
    }
}

// ===== COLOR CHOOSER =====
function showColorChooser() {
    const chooser = document.getElementById('color-chooser');
    if (chooser) {
        chooser.classList.remove('hidden');
        chooser.style.pointerEvents = 'auto';
        chooser.style.zIndex = '99999';
    }
}

function hideColorChooser() {
    const chooser = document.getElementById('color-chooser');
    if (chooser) {
        chooser.classList.add('hidden');
        chooser.style.pointerEvents = 'none';
    }
    colorChooserVisible = false;
}

function formatPlacement(rank) {
    if (rank === 1) return '1ST';
    if (rank === 2) return '2ND';
    if (rank === 3) return '3RD';
    return `${rank}TH`;
}

function getMedalEmoji(rank) {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return '';
}

function getStandings(players, scores = {}) {
    return [...players]
        .map(p => ({
            id: p.id,
            name: p.name,
            emoji: p.emoji,
            score: scores[p.id] || 0,
            cards: p.hand ? p.hand.length : 0,
            eliminated: !!p.eliminated
        }))
        .sort((a, b) => b.score - a.score || a.cards - b.cards || a.name.localeCompare(b.name));
}

function renderScoreboard(listEl, players, scores) {
    if (!listEl) return;
    const standings = getStandings(players, scores);
    listEl.innerHTML = standings.map((p, idx) => {
        const medal = getMedalEmoji(idx + 1);
        const bgColor = idx === 0 ? 'rgba(255, 215, 0, 0.08)' : idx === 1 ? 'rgba(192, 192, 192, 0.06)' : idx === 2 ? 'rgba(205, 127, 50, 0.06)' : 'transparent';
        const borderColor = idx === 0 ? 'rgba(255, 215, 0, 0.3)' : idx === 1 ? 'rgba(192, 192, 192, 0.2)' : idx === 2 ? 'rgba(205, 127, 50, 0.2)' : 'rgba(255,255,255,0.1)';
        return `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 8px; gap:12px; margin:4px 0; border-radius:6px; background:${bgColor}; border:1px solid ${borderColor}; transition:all 0.2s ease;">
            <span style="display:flex; align-items:center; gap:10px; flex:1;">
                <strong style="font-size:1.1em; min-width:30px;">${medal || formatPlacement(idx + 1)}</strong>
                <span>${p.emoji}</span>
                <span style="font-weight:600; color:rgba(255,255,255,0.95);">${p.name.toUpperCase()}</span>
            </span>
            <strong style="color:${idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : 'rgba(255,255,255,0.8)'}; font-size:1.05em;">${p.score} PTS</strong>
        </div>
    `}).join('');
}

function activeMultiplayerPlayers(sourcePlayers = (game ? game.players : [])) {
    return sourcePlayers.filter(p => p && p.name !== 'VACANT' && !p.eliminated);
}

function allPlayersReadyForNextRound(statePlayers, readySet = {}) {
    const activePlayers = activeMultiplayerPlayers(statePlayers);
    return activePlayers.length > 0 && activePlayers.every(p => readySet[p.id]);
}

function updateNextRoundButtonUI(newState) {
    const nextBtn = document.getElementById('play-again-btn');
    if (!nextBtn || !newState) return;

    const readySet = newState.nextRoundReadySet || {};
    const activePlayers = activeMultiplayerPlayers(newState.players || []);

    // Exclude host from calculation
    const nonHostPlayers = activePlayers.filter(p => !p.isHost && p.id !== myPlayerId);

    const readyCount = nonHostPlayers.filter(p => readySet[p.id]).length;
    const totalCount = nonHostPlayers.length; // n-1 players

    if (isMultiplayer) {
        if (isHost) {
            nextBtn.textContent =
                totalCount > 0 && readyCount === totalCount
                    ? 'Start Next Round'
                    : `Waiting ${readyCount}/${totalCount} Ready`;

            nextBtn.disabled = totalCount > 0 && readyCount !== totalCount;
        } else {
            nextBtn.textContent = readySet[myPlayerId]
                ? 'Cancel Ready'
                : 'Ready for Next Round';

            nextBtn.disabled = false;
        }
    } else {
        nextBtn.textContent = 'Next Round';
        nextBtn.disabled = false;
    }
}

// ===== RENDERING =====
function loadCardImages() {
    const staticFiles = [
        '+10.png', '+6.png', 'background.png', 'blue+2.png', 'blue0.png', 'blue1.png', 'blue2.png',
        'blue3.png', 'blue4+.png', 'blue4.png', 'blue5.png', 'blue6.png', 'blue7.png', 'blue8.png',
        'blue9.png', 'blueblock.png', 'bluereverse.png', 'blueskipall.png', 'colorchange.png',
        'discardallblue.png', 'discardallgreen.png', 'discardallred.png', 'discardallyellow.png',
        'green+2.png', 'green0.png', 'green1.png', 'green2.png', 'green3.png', 'green4+.png',
        'green4.png', 'green5.png', 'green6.png', 'green7.png', 'green8.png', 'green9.png',
        'greenblock.png', 'greenreverse.png', 'greenskipall.png', 'red0.png', 'red1.png', 'red2+.png',
        'red2.png', 'red3.png', 'red4+.png', 'red4.png', 'red5.png', 'red6.png', 'red7.png', 'red8.png',
        'red9.png', 'redblock.png', 'redrevrese.png', 'redskipall.png', 'reverse4+.png', 'yellow0.png',
        'yellow1.png', 'yellow2+.png', 'yellow2.png', 'yellow3.png', 'yellow4+.png', 'yellow4.png',
        'yellow5.png', 'yellow6.png', 'yellow7.png', 'yellow8.png', 'yellow9.png', 'yellowblock.png',
        'yellowrevrese.png', 'yellowskipall.png'
    ];
    staticFiles.forEach(file => {
        if (!cardImages[file]) {
            const img = new Image();
            img.src = file;
            cardImages[file] = img;
        }
    });
    bgImage = cardImages['background.png'];
}

function renderCard(x, y, w, h, card, isFaceUp = true, alpha = 1, rotation = 0) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(rotation);
    ctx.translate(-w / 2, -h / 2);

    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 12 * SCALE;
    ctx.shadowOffsetY = 4 * SCALE;

    if (card && card.isPlayable) {
        ctx.shadowColor = 'rgba(100,200,255,0.7)';
        ctx.shadowBlur = 20 * SCALE;
    }

    ctx.beginPath();
    const r = Math.min(CARD_R * SCALE, w * 0.12, h * 0.08);
    ctx.roundRect(0, 0, w, h, r);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.clip();

    if (isFaceUp && card) {
        const img = cardImages[card.filename];
        if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, 0, 0, w, h);
        } else {
            ctx.fillStyle = card.color === 'wild' ? '#2a2a3a' : (card.color || '#555');
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(12, w * 0.2)}px Outfit`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(card.value || '?', w / 2, h / 2);
        }
    } else {
        if (bgImage && bgImage.complete && bgImage.naturalWidth > 0) {
            ctx.drawImage(bgImage, 0, 0, w, h);
        } else {
            ctx.fillStyle = '#0f2542';
            ctx.fillRect(0, 0, w, h);
        }
    }
    ctx.restore();
}

function draw() {
    if (!game) return;
    
    // Optimize clearRect by checking if canvas size changed
    if (lastCanvasW !== gameCanvas.width || lastCanvasH !== gameCanvas.height) {
        ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
        lastCanvasW = gameCanvas.width;
        lastCanvasH = gameCanvas.height;
        cachedGradient = null; // Invalidate cached gradient
    } else {
        ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
    }

    // Cache gradient to avoid recreating every frame
    if (!cachedGradient) {
        const grad = ctx.createRadialGradient(gameCanvas.width/2, gameCanvas.height/2, 0, gameCanvas.width/2, gameCanvas.height/2, gameCanvas.width*0.8);
        grad.addColorStop(0, '#1e293b');
        grad.addColorStop(1, '#080c14');
        cachedGradient = grad;
    }
    ctx.fillStyle = cachedGradient;
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

    // Vignette - simplified on mobile to reduce overhead
    if (!isMobile() || !isScrolling) {
        const vig = ctx.createRadialGradient(gameCanvas.width/2, gameCanvas.height/2, gameCanvas.width*0.2, gameCanvas.width/2, gameCanvas.height/2, gameCanvas.width);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(0,0,0,0.6)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    } else {
        // Simpler vignette on mobile during scrolling
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    }

    const cx = gameCanvas.width / 2;
    const cy = gameCanvas.height / 2;

    // ===== LAYOUT REGIONS =====
    // Mobile landscape size adjustment for human player
    const dpr = window.devicePixelRatio || 1;
    const mobileLandscape = isMobile() && !isPortrait();
    const hScale = mobileLandscape ? 1.4 : 1;
    const hCW = CARD_W * hScale;
    const hCH = CARD_H * hScale;

    // Human hand at bottom, deck/discard in center, opponents distributed in top 55%
    const handAreaH = hCH + 80 * SCALE;
    const hudH = 70 * SCALE;
    const tableAreaTop = hudH;
    const tableAreaBot = gameCanvas.height - handAreaH;
    const tableAreaMid = tableAreaTop + (tableAreaBot - tableAreaTop) / 2;

    // Deck & Discard - centered in play area
    const deckDiscardY = tableAreaMid - CARD_H / 2;
    const deckX = cx - CARD_W - 15 * SCALE;
    const discardX = cx + 15 * SCALE;

    renderDeck(deckX, deckDiscardY);
    renderDiscardPile(discardX, deckDiscardY);

    // Opponents
    opponentBounds = [];
    const others = game.players.filter((p, i) => i !== myPlayerIndex && !p.eliminated);
    drawOpponents(others, tableAreaTop, tableAreaBot, deckDiscardY, cx);

    // Human player hand
    const myPlayer = game.players[myPlayerIndex];
    if (myPlayer && !myPlayer.eliminated) {
        drawHumanHand(myPlayer, cx, gameCanvas.height - handAreaH + 10 * SCALE, hCW, hCH);
    }

    // Dim overlay when waiting for color choice
    if (game.waitingForColor && game.players[game.currentPlayerIndex]?.id === myPlayerId) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);
    }
    
    // Swap hands overlay
    if (game.waitingForSwap && game.players[game.currentPlayerIndex]?.id === myPlayerId) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, gameCanvas.height / 2 - 50 * SCALE, gameCanvas.width, gameCanvas.height / 2 + 50 * SCALE);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(16, 24 * SCALE)}px Outfit`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 10;
        ctx.fillText('CLICK AN OPPONENT ABOVE TO SWAP HANDS', cx, deckDiscardY + CARD_H + 40 * SCALE);
        ctx.restore();
    }

    updateHTMLHUD();
}

function drawOpponents(others, tableTop, tableBot, deckMidY, cx) {
    if (others.length === 0) return;

    const mobile = isMobile();
    const portrait = isPortrait();
    const n = others.length;

    // Determine zone for opponents: top area above the deck/discard
    // We split the top zone into slots
    const topZoneTop = tableTop + 5 * SCALE;
    const topZoneBot = deckMidY - 10 * SCALE; // just above deck area
    const topZoneH = topZoneBot - topZoneTop;
    const topZoneMidY = topZoneTop + topZoneH / 2;

    // Bot card size - smaller than human cards
    const botScale = mobile ? (portrait ? 0.52 : 0.45) : 0.62;
    const bW = CARD_W * botScale / SCALE * SCALE;
    const bH = CARD_H * botScale / SCALE * SCALE;

    // Spread opponents horizontally across top zone
    // For portrait mobile with many opponents, use 2 rows
    const useDoubleRow = portrait && mobile && n > 3;
    const row1Count = useDoubleRow ? Math.ceil(n / 2) : n;
    const row2Count = useDoubleRow ? Math.floor(n / 2) : 0;

    const drawOpponent = (p, centerX, centerY, cardW, cardH) => {
        const isCurrentTurn = game.currentPlayerIndex === game.players.indexOf(p);
        const isDisconnected = !!p.disconnected;
        const cardCount = p.hand.length;
        const maxCards = Math.min(cardCount, 8);
        const cardSpacing = Math.min(cardW * 0.45, (cardW * 3) / Math.max(maxCards, 1));
        const totalW = (maxCards - 1) * cardSpacing + cardW;
        const startX = centerX - totalW / 2;

        // Turn highlight ring
        if (isCurrentTurn) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(centerX, centerY + cardH / 2, Math.max(totalW / 2, cardH / 2) + 12 * SCALE, 0, Math.PI * 2);
            ctx.strokeStyle = isDisconnected ? 'rgba(255,100,100,0.5)' : 'rgba(59,130,246,0.6)';
            ctx.lineWidth = 3 * SCALE;
            ctx.setLineDash([6 * SCALE, 4 * SCALE]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        // Draw cards (dimmed if disconnected)
        ctx.save();
        ctx.globalAlpha = isDisconnected ? 0.35 : 1.0;
        for (let i = 0; i < maxCards; i++) {
            renderCard(startX + i * cardSpacing, centerY, cardW, cardH, null, false);
        }
        ctx.globalAlpha = 1.0;
        ctx.restore();

        if (cardCount > 8) {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.font = `bold ${Math.max(10, cardH * 0.2)}px Outfit`;
            ctx.textAlign = 'center';
            ctx.fillText(`+${cardCount - 8}`, startX + maxCards * cardSpacing, centerY + cardH / 2);
            ctx.restore();
        }

        // Disconnected overlay badge
        if (isDisconnected) {
            ctx.save();
            const badgeW = Math.max(80 * SCALE, totalW * 0.8);
            const badgeH = cardH * 0.38;
            const badgeX = centerX - badgeW / 2;
            const badgeY = centerY + cardH / 2 - badgeH / 2;
            ctx.fillStyle = 'rgba(20,20,30,0.82)';
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6 * SCALE);
            ctx.fill();
            ctx.fillStyle = '#f87171';
            ctx.font = `bold ${Math.max(9, cardH * 0.13)}px Outfit`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('📡 RECONNECTING...', centerX, badgeY + badgeH / 2);
            ctx.textBaseline = 'alphabetic';
            ctx.restore();
        }

        // Name label
        const labelY = centerY + cardH + 18 * SCALE;
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 10;
        ctx.fillStyle = isDisconnected ? '#f87171' : (isCurrentTurn ? '#60a5fa' : 'rgba(255,255,255,0.9)');
        const fontSize = Math.max(11, (mobile ? 13 : 15) * SCALE);
        ctx.font = `bold ${fontSize}px Outfit`;
        ctx.textAlign = 'center';
        ctx.fillText(`${p.emoji} ${p.name} (${cardCount})`, centerX, labelY);
        if (isDisconnected) {
            ctx.fillStyle = '#f87171';
            ctx.font = `bold ${Math.max(9, fontSize * 0.75)}px Outfit`;
            ctx.fillText('DISCONNECTED', centerX, labelY + fontSize + 3 * SCALE);
        } else if (isCurrentTurn) {
            ctx.fillStyle = '#60a5fa';
            ctx.font = `bold ${Math.max(9, fontSize * 0.75)}px Outfit`;
            ctx.fillText('▶ PLAYING', centerX, labelY + fontSize + 3 * SCALE);
        }
        ctx.restore();

        opponentBounds.push({
            x: startX,
            y: centerY,
            w: totalW,
            h: cardH + 40 * SCALE,
            pIdx: game.players.indexOf(p)
        });
    };

    if (n === 1) {
        drawOpponent(others[0], cx, topZoneTop + (topZoneH - bH) / 2, bW, bH);
    } else if (!useDoubleRow) {
        // Single row - distribute evenly
        const padding = mobile ? 30 * SCALE : 50 * SCALE;
        const slotW = (gameCanvas.width - padding * 2) / n;
        for (let i = 0; i < n; i++) {
            const slotCX = padding + slotW * i + slotW / 2;
            const slotCY = topZoneTop + (topZoneH - bH) / 2;
            drawOpponent(others[i], slotCX, slotCY, bW, bH);
        }
    } else {
        // Double row for portrait mobile with many players
        const padding = 20 * SCALE;
        const row1Y = topZoneTop + 5 * SCALE;
        const row2Y = topZoneTop + bH + 40 * SCALE;
        const row1SW = (gameCanvas.width - padding * 2) / row1Count;
        const row2SW = (gameCanvas.width - padding * 2) / Math.max(row2Count, 1);

        for (let i = 0; i < row1Count; i++) {
            drawOpponent(others[i], padding + row1SW * i + row1SW / 2, row1Y, bW, bH);
        }
        for (let i = 0; i < row2Count; i++) {
            drawOpponent(others[row1Count + i], padding + row2SW * i + row2SW / 2, row2Y, bW, bH);
        }
    }
}

function updateHTMLHUD() {
    if (!game) return;
    if (timerElement) {
        timerElement.textContent = game.turnTimer;
        timerElement.style.color = game.turnTimer <= 5 ? '#ef4444' : 'white';
        timerElement.style.borderColor = game.turnTimer <= 5 ? '#ef4444' : 'rgba(255,255,255,0.3)';
    }

    const currentP = game.getCurrentPlayer();
    if (currentPlayerNameHUD && currentP) {
        const isMyTurn = game.currentPlayerIndex === myPlayerIndex;
        currentPlayerNameHUD.textContent = isMyTurn ? `${currentP.emoji} YOUR TURN` : `${currentP.emoji} ${currentP.name.toUpperCase()}`;
        currentPlayerNameHUD.style.color = isMyTurn ? '#60a5fa' : 'white';
    }

    if (playerColorCircle) {
        const colors = { red: '#ff1744', blue: '#2979ff', green: '#00e676', yellow: '#ffea00' };
        playerColorCircle.style.background = colors[game.chosenColor] || 'transparent';
        if (colors[game.chosenColor]) {
            playerColorCircle.style.borderColor = 'white';
            playerColorCircle.style.boxShadow = `0 0 10px ${colors[game.chosenColor]}`;
        } else {
            playerColorCircle.style.borderColor = 'rgba(255,255,255,0.3)';
            playerColorCircle.style.boxShadow = 'none';
        }
    }

    if (penaltyCounter && penaltyValue) {
        if (game.stackPenalty > 0) {
            penaltyCounter.classList.remove('vis-hidden', 'hidden');
            penaltyValue.textContent = game.stackPenalty;
        } else {
            penaltyCounter.classList.add('vis-hidden');
        }
    }

    // UNO / Catch UNO button visibility
    const myPlayer = game.players[myPlayerIndex];
    const isMyTurn = game.currentPlayerIndex === myPlayerIndex;
    if (unoActionBtn) {
        // Show UNO button from the start of the game for active players
        const showUno = myPlayer && !myPlayer.eliminated;
        unoActionBtn.classList.toggle('vis-hidden', !showUno);
        unoActionBtn.classList.remove('hidden'); // Ensure it's not display:none
    }
    if (catchUnoBtn) {
        // Show Catch UNO button from the start of the game for active players
        const canCatch = myPlayer && !myPlayer.eliminated;
        catchUnoBtn.classList.toggle('vis-hidden', !canCatch);
        catchUnoBtn.classList.remove('hidden'); // Ensure it's not display:none
    }
}

function renderDeck(x, y) {
    for (let i = 0; i < 3; i++) renderCard(x + i * 2, y - i * 2, CARD_W, CARD_H, null, false);
    // Draw label
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `bold ${Math.max(9, 11 * SCALE)}px Outfit`;
    ctx.textAlign = 'center';
    const text = (game && game.hasDrawnThisTurn && game.currentPlayerIndex === myPlayerIndex) ? 'PASS' : 'DRAW';
    ctx.fillText(text, x + CARD_W / 2, y + CARD_H + 14 * SCALE);
    ctx.restore();
}

function renderDiscardPile(x, y) {
    const top = game.getTopCard();
    if (top) renderCard(x, y, CARD_W, CARD_H, top);
}

function drawHumanHand(p, centerX, baseY, cw, ch) {
    humanCardBounds = [];
    const n = p.hand.length;
    const dpr = window.devicePixelRatio || 1;
    if (n === 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = `bold ${16 * SCALE}px Outfit`;
        ctx.textAlign = 'center';
        ctx.fillText('No cards!', centerX, baseY + ch / 2);
        return;
    }

    const isMyTurn = game.currentPlayerIndex === myPlayerIndex;
    const maxHandW = Math.min(gameCanvas.width - 80 * SCALE, cw * 10);
    const minSpacing = cw * 0.55;
    const naturalSpacing = cw * 1.1;
    const cardSpacing = n > 1 ? Math.min(naturalSpacing, Math.max(minSpacing, (maxHandW - cw) / (n - 1))) : 0;
    const totalWidth = n === 1 ? cw : (n - 1) * cardSpacing + cw;
    const isOverflow = totalWidth > maxHandW;

    let startX;
    if (isOverflow) {
        startX = (centerX - maxHandW / 2) + handScrollX;
        ctx.save();
        ctx.beginPath();
        ctx.rect(centerX - maxHandW / 2 - 5, baseY - 35 * SCALE, maxHandW + 10, ch + 60 * SCALE);
        ctx.clip();
    } else {
        startX = centerX - totalWidth / 2;
    }

    // Card count indicator
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `bold ${Math.max(10 * dpr, 12 * SCALE)}px Outfit`;
    ctx.textAlign = 'center';
    ctx.fillText(`${n} CARDS`, centerX, baseY - 8 * SCALE);
    ctx.restore();

    p.hand.forEach((card, idx) => {
        const x = startX + idx * cardSpacing;
        const isPlayable = game.isValidMove(card, idx) && isMyTurn;
        card.isPlayable = isPlayable;
        const lift = (idx === hoveredCardIndex) ? 18 * SCALE : (isPlayable && isMyTurn ? 5 * SCALE : 0);
        const y = baseY - lift;
        humanCardBounds.push({ x, y, w: cw, h: ch, i: idx });
        renderCard(x, y, cw, ch, card, true);
    });

    if (isOverflow) {
        ctx.restore();
        // Scrollbar
        const barW = maxHandW;
        const barH = 5 * SCALE;
        const barX = centerX - barW / 2;
        const barY = baseY + ch + 8 * SCALE;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.roundRect(barX, barY, barW, barH, barH / 2);
        ctx.fill();
        const totalW2 = (n - 1) * cardSpacing + cw;
        const handleW = Math.max(30 * SCALE, (maxHandW / totalW2) * barW);
        const scrollRange = totalW2 - maxHandW;
        const handleX = barX + (Math.abs(handScrollX) / scrollRange) * (barW - handleW);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.beginPath();
        ctx.roundRect(handleX, barY, handleW, barH, barH / 2);
        ctx.fill();
    }

    // Player name label
    ctx.save();
    ctx.fillStyle = isMyTurn ? '#60a5fa' : 'rgba(255,255,255,0.8)';
    const mobileLandscape = isMobile() && !isPortrait();
    const labelScale = mobileLandscape ? SCALE * 1.5 : SCALE;
    ctx.font = `bold ${Math.max(11 * dpr, 14 * labelScale)}px Outfit`;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 8;
    ctx.fillText(`${p.emoji} ${p.name.toUpperCase()}`, centerX, baseY + ch + 22 * SCALE);
    ctx.restore();
}

function executeBotTurn() {
    if (!game || game.gameOver || game.waitingForColor) return;
    const p = game.getCurrentPlayer();
    if (!p || !p.isBot) return;
    const validIndices = [];
    p.hand.forEach((c, idx) => { if (game.isValidMove(c)) validIndices.push(idx); });
    if (validIndices.length > 0) {
        const idx = validIndices[0];
        if (p.hand.length === 2 && Math.random() > 0.3) {
            p.unoCalled = true;
            showAlert(`${p.name} CALLED UNO!`);
        }
        game.playCard(game.currentPlayerIndex, idx, true);
    } else {
        game.drawCard();
    }
}

function gameLoop() {
    if (!gameRunning) return;
    if (game && !game.gameOver) {
        game.updateTimer();
        // FIX: Only call autoPlay once per turn, not repeatedly each frame
        if (game.turnTimer <= 0 && !game.waitingForColor && !game.waitingForSwap) {
            const isMyTurnLocal = game.currentPlayerIndex === myPlayerIndex;
            const currentP = game.getCurrentPlayer();
            const currentTime = Date.now();
            // Auto-play disconnected players' turns (host acts as proxy bot for them)
            const isDisconnectedTurn = isMultiplayer && isHost && currentP && currentP.disconnected && !currentP.isBot;
            if (isDisconnectedTurn && currentTime - lastAutoPlayTime > 500) {
                lastAutoPlayTime = currentTime;
                game.autoPlay();
            } else if ((!isMultiplayer || isMyTurnLocal) && currentTime - lastAutoPlayTime > 500) {
                lastAutoPlayTime = currentTime;
                game.autoPlay();
            }
        }
        if (!isMultiplayer) {
            const currentP = game.getCurrentPlayer();
            const turnElapsed = Date.now() - game.turnStartTime;
            if (currentP && currentP.isBot && !game.waitingForColor && turnElapsed > BOT_PLAY_DELAY + 200) {
                executeBotTurn();
            }
        }
        // Multiplayer: also execute bot turns on host side
        if (isMultiplayer && isHost) {
            const currentP = game.getCurrentPlayer();
            const turnElapsed = Date.now() - game.turnStartTime;
            if (currentP && currentP.isBot && !game.waitingForColor && !game.waitingForSwap && turnElapsed > BOT_PLAY_DELAY + 200) {
                executeBotTurn();
            }
        }
    }
    
    // Mobile-optimized frame throttling
    const now = Date.now();
    const targetFPS = isMobile() && isScrolling ? MOBILE_FRAME_RATE : (isMobile() ? 45 : DESKTOP_FRAME_RATE);
    const frameInterval = 1000 / targetFPS;
    
    if (now - lastDrawTime >= frameInterval) {
        draw();
        lastDrawTime = now;
    }
    
    requestAnimationFrame(gameLoop);
}

// ===== MULTIPLAYER STATE SYNC =====
function applyRemoteState(newState) {
    if (!newState || !game) return;
    // Avoid re-applying our own sync
    if (newState.lastUpdate === lastSyncedState) return;
    lastSyncedState = newState.lastUpdate;

    // Restore card objects
    const makeCard = (c) => c ? new Card(c.color, c.value, c.filename) : null;
    game.discardPile = newState.discardPile.map(makeCard).filter(Boolean);
    game.deck = newState.deck.map(makeCard).filter(Boolean);

    // Sync player hands - SAFER reconstruction that maintains ID mapping
    const oldPlayersMap = new Map(game.players.map(p => [p.id, p]));
    game.players = newState.players.map((p, idx) => {
        let player = oldPlayersMap.get(p.id);
        if (player) {
            // Update existing player object in place
            player.name = p.name;
            player.emoji = p.emoji;
            player.isBot = p.isBot;
            player.isHost = p.isHost || false;
            player.authUID = p.authUID || player.authUID || null;
            player.deviceId = p.deviceId || player.deviceId || null;
            player.disconnected = p.disconnected || false;
            player.hand = p.hand.map(makeCard).filter(Boolean);
            player.unoCalled = p.unoCalled;
            player.eliminated = p.eliminated;
            return player;
        } else {
            // Create new player if doesn't exist
            const newPlayer = new Player(p.name, p.emoji, p.isBot, p.id, p.isHost || false, p.deviceId, p.authUID);
            newPlayer.hand = p.hand.map(makeCard).filter(Boolean);
            newPlayer.unoCalled = p.unoCalled;
            newPlayer.eliminated = p.eliminated;
            newPlayer.disconnected = p.disconnected || false;
            return newPlayer;
        }
    });

    // FIX: ALWAYS use server's currentPlayerIndex as authoritative
    // Don't try to validate or "fix" it - the server has already done that
    game.currentPlayerIndex = newState.currentPlayerIndex;

    // Recalculate myPlayerIndex
    const me = game.players.findIndex(p => p.id === myPlayerId);
    if (me !== -1) myPlayerIndex = me;

    // Sync game fields
    game.gameDirection = newState.gameDirection;
    game.stackPenalty = newState.stackPenalty;
    game.gameOver = newState.gameOver;
    game.chosenColor = newState.chosenColor;

    // **FIX: Always sync scores from remote state so points accumulate across rounds**
    if (newState.scores) {
        game.scores = { ...newState.scores };
    }

    // Sync nextRoundReadySet
    if (newState.nextRoundReadySet) {
        game.nextRoundReadySet = { ...newState.nextRoundReadySet };
    }

    // Update color glow indicator
    updateColorGlow(game.chosenColor);

    // Broadcast alerts
    if (newState.lastAlert && newState.lastAlertTime !== game.lastAlertTime) {
        showAlert(newState.lastAlert);
        game.lastAlert = newState.lastAlert;
        game.lastAlertTime = newState.lastAlertTime;
    }

    // Handle waiting states
    const amIWaiting = (newState.waitingForColor || newState.waitingForSwap) && newState.waitingPlayerId === myPlayerId;
    game.waitingForColor = newState.waitingForColor;
    game.waitingForSwap = newState.waitingForSwap;
    game.hasDrawnThisTurn = newState.hasDrawnThisTurn || false;
    game.drawnCardIndexThisTurn = newState.drawnCardIndexThisTurn !== undefined ? newState.drawnCardIndexThisTurn : -1;

    // FIX: Color chooser should ONLY show for the player who is actually waiting for color
    if (newState.waitingForColor && newState.waitingPlayerId === myPlayerId && !colorChooserVisible) {
        colorChooserVisible = true;
        showColorChooser();
    } else if (colorChooserVisible && (newState.waitingForColor && newState.waitingPlayerId !== myPlayerId || !newState.waitingForColor)) {
        // Hide if: no longer waiting for color, OR waiting for color but for a different player
        hideColorChooser();
    }

    if (newState.gameOver && game) {
        // Find winner based on new state
        const winner = newState.players.find(p => p.hand.length === 0) || newState.players.filter(p => !p.eliminated)[0];
        if (winner) {
            const isChamp = (newState.scores[winner.id] || 0) >= 1000;
            winnerNameDisplay.textContent = isChamp ? `${winner.name.toUpperCase()} IS THE CHAMPION!` : `${winner.name.toUpperCase()} WINS THE ROUND!`;
            document.getElementById('game-over-subtitle').textContent = `Total Points: ${newState.scores[winner.id] || 0} / 1000`;
            
            const scoreList = document.getElementById('scoreboard-list');
            if (scoreList) {
                renderScoreboard(scoreList, newState.players.map(p => ({...p, hand: p.hand || []})), newState.scores);
            }
            
            gameOverModal.classList.remove('hidden');
            // Update the next round button UI for all players
            updateNextRoundButtonUI(newState);
        }
    }

    // If game is over and we receive updated nextRoundReadySet, update the button UI
     if (game.gameOver) {
        updateNextRoundButtonUI(newState);
    }
}

// ===== GAME UI INITIALIZATION =====
function initGameUI() {
    // Settings button - fix for all modes
    if (settingsTrigger) {
        settingsTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            if (settingsModal) settingsModal.classList.toggle('hidden');
        });
    }
    if (closeSettings) closeSettings.addEventListener('click', () => { settingsModal.classList.add('hidden'); rulesView.classList.add('hidden'); });
    if (howToPlay) howToPlay.addEventListener('click', () => {
        rulesView.classList.toggle('hidden');
        // Show room code if in multiplayer game
        const roomCodeDisplay = document.getElementById('room-code-display');
        const displayRoomCode = document.getElementById('display-room-code');
        if (currentRoomCode && (gameRunning || isMultiplayer)) {
            if (roomCodeDisplay) roomCodeDisplay.classList.remove('hidden');
            if (displayRoomCode) displayRoomCode.textContent = currentRoomCode;
        } else {
            if (roomCodeDisplay) roomCodeDisplay.classList.add('hidden');
        }
    });
    if (exitToMenu) exitToMenu.addEventListener('click', () => location.reload());
    
    if (playAgainBtn) playAgainBtn.onclick = async () => {
        if (!game) return;
        const isChamp = Object.values(game.scores).some(s => s >= 1000);
        const passedScores = isChamp ? {} : { ...game.scores };
        
        if (!isMultiplayer) {
            // Single player: just start a new round
            const currentPlayers = game.players.map(p => ({ name: p.name, emoji: p.emoji, isBot: p.isBot, id: p.id, authUID: p.authUID, deviceId: p.deviceId }));
            game = new UNOGame(currentPlayers, passedScores);
            myPlayerIndex = 0;
            gameOverModal.classList.add('hidden');
            gameRunning = true;
        }else if (isHost) {
    const readySet = game.nextRoundReadySet || {};
    const nonHostActivePlayers = activeMultiplayerPlayers(game.players).filter(p => p.id !== myPlayerId);
    const allReady = nonHostActivePlayers.length === 0 || nonHostActivePlayers.every(p => readySet[p.id]);

    if (!allReady) {
        showAlert('Waiting for all players to be ready...');
        return;
    }

    const currentPlayers = game.players.map(p => ({ name: p.name, emoji: p.emoji, isBot: false, id: p.id, authUID: p.authUID, deviceId: p.deviceId }));
    const freshGame = new UNOGame(currentPlayers, passedScores);
    game = freshGame;
    const me = game.players.findIndex(p => p.id === myPlayerId);
    if (me !== -1) myPlayerIndex = me;
    lastAutoPlayTime = 0; // FIX: Reset autoPlay timer for new round
    gameOverModal.classList.add('hidden');
    gameRunning = true;
    // gameOver: false ensures all clients detect "new round started"
    await updateRoomState(currentRoomCode, { ...game.serialize(), gameStarted: true, gameOver: false });
        } else {
    const readySet = { ...(game.nextRoundReadySet || {}) };
    if (readySet[myPlayerId]) {
        delete readySet[myPlayerId];
    } else {
        readySet[myPlayerId] = true;
    }
    game.nextRoundReadySet = readySet;
    const serialized = game.serialize(); // serialize() includes gameOver:true still
    await updateRoomState(currentRoomCode, serialized);
    updateNextRoundButtonUI(serialized);
}
    };
    
    if (gameOverExitBtn) gameOverExitBtn.onclick = () => location.reload();

    // Close settings when clicking backdrop
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) settingsModal.classList.add('hidden');
        });
    }

    // ===== AUTH MODAL LISTENERS =====
    const googleLoginBtn = document.getElementById('google-login-btn');
    const closeAuthBtn = document.getElementById('close-auth-btn');
    const signinGoogleBtn = document.getElementById('signin-google-btn');
    
    if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', async () => {
            showAuthLoading(true);
            try {
                if (!supabase) {
                    showAlert('❌ Supabase not initialized');
                    showAuthLoading(false);
                    return;
                }
                console.log('Clicking Google sign-in...');
                const result = await signInWithGoogle();
                if (result.success) {
                    showAlert('✅ Redirecting to Google...');
                } else {
                    showAlert(result.error || 'Google sign-in failed');
                    showAuthLoading(false);
                }
            } catch (error) {
                showAlert('❌ Error: ' + error.message);
                showAuthLoading(false);
            }
        });
    }
    
    // Close auth modal button
    if (closeAuthBtn) {
        closeAuthBtn.addEventListener('click', () => {
            closeAuthModal();
        });
    }
    
    // Sign in with Google button in main menu
    if (signinGoogleBtn) {
        signinGoogleBtn.addEventListener('click', () => {
            mainMenu.classList.add('hidden');
            showAuthModal();
        });
    }

    // Menu buttons
    startGameBtn.addEventListener('click', () => { mainMenu.classList.add('hidden'); gameModeMenu.classList.remove('hidden'); });

    singlePlayerBtn.addEventListener('click', () => {
        isMultiplayer = false;
        gameModeMenu.classList.add('hidden');
        playerSetupMenu.classList.remove('hidden');
    });

    multiplayerBtn.addEventListener('click', () => {
        gameModeMenu.classList.add('hidden');
        multiplayerMenu.classList.remove('hidden');
    });

    document.getElementById('join-hub-btn').addEventListener('click', () => {
        multiplayerMenu.classList.add('hidden');
        joinRoomPanel.classList.remove('hidden');
    });

    document.getElementById('create-room-btn').addEventListener('click', () => {
        isMultiplayer = true;
        isHost = true;
        currentRoomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        hostPlayerId = null;
        multiplayerMenu.classList.add('hidden');
        playerSetupMenu.classList.remove('hidden');
    });

    document.getElementById('confirm-join-btn').addEventListener('click', async () => {
        // Only authenticated users or guests can join multiplayer
        if (!currentAuthUID && !isGuestMode) {
            console.log('Join attempt - Auth check failed. currentAuthUID:', currentAuthUID, 'isGuestMode:', isGuestMode);
            return showAlert("❌ Please sign in or continue as guest");
        }
        
        console.log('Joining room - Auth UID:', currentAuthUID, 'Guest mode:', isGuestMode);
        
        const code = document.getElementById('join-code-input').value.toUpperCase().trim();
        const name = document.getElementById('join-name-input').value.trim() || 'Player';
        myPlayerName = name;
        const emoji = document.getElementById('join-emoji-input').value || '👤';
        if (!code) return showAlert("Please enter a room code");

        const room = await joinRoom(code);
        if (!room) return showAlert("Room not found!");
        
        // Check if game is in progress
        const gameInProgress = room.state.gameStarted && !room.state.gameOver;
        
        if (!gameInProgress && room.state.players && room.state.players.length >= 6) return showAlert("Room is full!");

        isMultiplayer = true;
        isHost = false;
        currentRoomCode = code;
        
        // Check if this authenticated user already has a player in the game
        const existingPlayer = currentAuthUID ? findPlayerByAuthUID(room.state.players || [], currentAuthUID) : null;
        console.log('=== REJOIN CHECK ===');
        console.log('Current Auth UID:', currentAuthUID);
        console.log('Room players:', room.state.players || []);
        console.log('Room players authUIDs:', (room.state.players || []).map(p => ({ name: p.name, authUID: p.authUID, id: p.id })));
        console.log('Game in progress:', gameInProgress);
        console.log('Existing player found:', existingPlayer ? existingPlayer.name : 'None');
        console.log('====================');
        
        if (existingPlayer && gameInProgress) {
            // ===== REJOIN: Authenticated user returning to their existing slot =====
            myPlayerId = existingPlayer.id;
            myPlayerName = existingPlayer.name;
            const existingPlayers = room.state.players || [];
            myPlayerIndex = existingPlayers.findIndex(p => p.id === myPlayerId);

            // Mark this player as reconnected (no longer disconnected)
            const makeCardR = (c) => c ? new Card(c.color, c.value, c.filename) : null;
            const updatedPlayers = existingPlayers.map(p => {
                if (p.id === myPlayerId) {
                    return { ...p, disconnected: false, isBot: false };
                }
                return p;
            });

            // Fully reconstruct game from DB state
            const rs = room.state;
            game = Object.create(UNOGame.prototype);
            // Assign all primitive/object fields manually
            game.deck           = (rs.deck || []).map(makeCardR).filter(Boolean);
            game.discardPile    = (rs.discardPile || []).map(makeCardR).filter(Boolean);
            game.currentPlayerIndex = rs.currentPlayerIndex || 0;
            game.gameDirection  = rs.gameDirection || 1;
            game.gameOver       = rs.gameOver || false;
            game.chosenColor    = rs.chosenColor || 'none';
            game.waitingForColor= rs.waitingForColor || false;
            game.waitingForSwap = rs.waitingForSwap || false;
            game.stackPenalty   = rs.stackPenalty || 0;
            game.scores         = rs.scores || {};
            game.lastAlert      = rs.lastAlert || null;
            game.lastAlertTime  = rs.lastAlertTime || 0;
            game.hasDrawnThisTurn = rs.hasDrawnThisTurn || false;
            game.drawnCardIndexThisTurn = rs.drawnCardIndexThisTurn !== undefined ? rs.drawnCardIndexThisTurn : -1;
            game.nextRoundReadySet = rs.nextRoundReadySet || {};
            game.turnStartTime  = Date.now();
            game.turnTimer      = 20;
            game.lastPlayedPlayerIndex = rs.lastPlayedPlayerIndex || null;
            game.gameStarted    = true;

            game.players = updatedPlayers.map(p => {
                const pl = new Player(p.name, p.emoji, p.isBot || false, p.id, p.isHost || false, p.deviceId || null, p.authUID || null);
                pl.hand = (p.hand || []).map(makeCardR).filter(Boolean);
                pl.eliminated = p.eliminated || false;
                pl.unoCalled  = p.unoCalled  || false;
                pl.disconnected = (p.id === myPlayerId) ? false : (p.disconnected || false);
                return pl;
            });

            // Push updated (reconnected) state back to DB so host sees reconnection
            await updateRoomState(currentRoomCode, { ...rs, players: updatedPlayers });

            loadCardImages();
            joinRoomPanel.classList.add('hidden');
            gameContainer.classList.remove('hidden');
            if (menuBackground) menuBackground.hide();
            if (isMobile()) fullscreenBtn.classList.remove('hidden');

            lastSyncedState = null; // Allow next state update to apply fully
            lastAutoPlayTime = 0;
            gameRunning = true;
            gameLoop();
            startHeartbeat(); // Let host know we're back
            setupMultiplayerSubscription();
            initializeChatSystem();
            updateColorGlow(game.chosenColor);
            showAlert(`✅ Welcome back, ${existingPlayer.name}! Your cards have been restored.`);

        } else if (gameInProgress) {
            // NEW JOIN MID-GAME: Different user or guest, add as new player
            myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
            const makeCardJ = (c) => c ? new Card(c.color, c.value, c.filename) : null;
            
            joinRoomPanel.classList.add('hidden');
            gameContainer.classList.remove('hidden');
            if (menuBackground) menuBackground.hide();
            if (isMobile()) fullscreenBtn.classList.remove('hidden');
            
            // Add player to the game with existing players
            const updatedPlayers = [...(room.state.players || []), { name, emoji, isBot: false, id: myPlayerId, ready: true, hand: [], deviceId, authUID: currentAuthUID || null }];
            myPlayerIndex = updatedPlayers.length - 1;
            
            const rs2 = room.state;
            game = Object.create(UNOGame.prototype);
            game.deck           = (rs2.deck || []).map(makeCardJ).filter(Boolean);
            game.discardPile    = (rs2.discardPile || []).map(makeCardJ).filter(Boolean);
            game.currentPlayerIndex = rs2.currentPlayerIndex || 0;
            game.gameDirection  = rs2.gameDirection || 1;
            game.gameOver       = rs2.gameOver || false;
            game.chosenColor    = rs2.chosenColor || 'none';
            game.waitingForColor= rs2.waitingForColor || false;
            game.waitingForSwap = rs2.waitingForSwap || false;
            game.stackPenalty   = rs2.stackPenalty || 0;
            game.scores         = rs2.scores || {};
            game.lastAlert      = rs2.lastAlert || null;
            game.lastAlertTime  = rs2.lastAlertTime || 0;
            game.hasDrawnThisTurn = rs2.hasDrawnThisTurn || false;
            game.drawnCardIndexThisTurn = rs2.drawnCardIndexThisTurn !== undefined ? rs2.drawnCardIndexThisTurn : -1;
            game.nextRoundReadySet = rs2.nextRoundReadySet || {};
            game.turnStartTime  = Date.now();
            game.turnTimer      = 20;
            game.lastPlayedPlayerIndex = rs2.lastPlayedPlayerIndex || null;
            game.gameStarted    = true;

            game.players = updatedPlayers.map(p => {
                const pl = new Player(p.name, p.emoji, p.isBot || false, p.id, p.isHost || false, p.deviceId || null, p.authUID || null);
                pl.hand = (p.hand || []).map(makeCardJ).filter(Boolean);
                pl.eliminated = p.eliminated || false;
                pl.unoCalled  = p.unoCalled  || false;
                return pl;
            });

            loadCardImages();
            lastSyncedState = null;
            lastAutoPlayTime = 0;
            gameRunning = true;
            gameLoop();
            startHeartbeat(); // Ping host so disconnect timer doesn't fire
            await updateRoomState(currentRoomCode, { ...rs2, players: updatedPlayers });
            setupMultiplayerSubscription();
            initializeChatSystem();
            updateColorGlow(game.chosenColor);
            showAlert(`✅ ${name} joined the game!`);
        } else {
            // Normal waiting room flow
            myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
            
            joinRoomPanel.classList.add('hidden');
            waitingRoomMenu.classList.remove('hidden');
            document.getElementById('waiting-room-code').textContent = currentRoomCode;
            document.getElementById('ready-btn').classList.remove('hidden');

            const updatedPlayers = [...(room.state.players || []), { name, emoji, isBot: false, id: myPlayerId, ready: false, deviceId, authUID: currentAuthUID || null }];
            myPlayerIndex = updatedPlayers.length - 1;
            await updateRoomState(currentRoomCode, { ...room.state, players: updatedPlayers });

            updateWaitingList(updatedPlayers);
            setupMultiplayerSubscription();
            initializeChatSystem();
            // Heartbeat will start once the game actually begins (detected via subscription)
        }
    });

    document.getElementById('back-btn-join').addEventListener('click', () => {
        joinRoomPanel.classList.add('hidden');
        multiplayerMenu.classList.remove('hidden');
    });

    document.getElementById('leave-room-btn').addEventListener('click', () => {
        waitingRoomMenu.classList.add('hidden');
        mainMenu.classList.remove('hidden');
        cleanupMultiplayer();
    });

    document.getElementById('start-multiplayer-btn').addEventListener('click', async () => {
        if (!isHost) return;
        
        // Fetch latest room state to get all players with correct authUIDs
        const latestRoom = await joinRoom(currentRoomCode);
        if (!latestRoom || !latestRoom.state.players) return showAlert("Failed to start game!");
        
        // Create fresh game with all players from latest room state (preserves authUIDs)
        const currentPlayers = latestRoom.state.players.map(p => ({ 
            name: p.name, 
            emoji: p.emoji, 
            isBot: false, 
            id: p.id, 
            deviceId: p.deviceId, 
            authUID: p.authUID 
        }));
        
        const freshGame = new UNOGame(currentPlayers);
        game = freshGame;
        myPlayerIndex = 0;
        lastAutoPlayTime = 0;
        waitingRoomMenu.classList.add('hidden');
        gameContainer.classList.remove('hidden');
        if (isMobile()) fullscreenBtn.classList.remove('hidden');
        gameRunning = true;
        gameLoop();
        setupHeartbeatListener(); // Host listens for player pings
        await updateRoomState(currentRoomCode, { ...game.serialize(), gameStarted: true });
    });

    document.getElementById('ready-btn').addEventListener('click', async () => {
        const room = await joinRoom(currentRoomCode);
        if (!room) return;
        const btn = document.getElementById('ready-btn');
        const isReady = btn.classList.contains('active');
        const updatedPlayers = room.state.players.map(p =>
            p.id === myPlayerId ? { ...p, ready: !isReady } : p
        );
        btn.classList.toggle('active', !isReady);
        await updateRoomState(currentRoomCode, { ...room.state, players: updatedPlayers });
    });

    document.getElementById('back-btn1').addEventListener('click', () => { gameModeMenu.classList.add('hidden'); mainMenu.classList.remove('hidden'); });
    document.getElementById('back-btn2').addEventListener('click', () => { multiplayerMenu.classList.add('hidden'); gameModeMenu.classList.remove('hidden'); });
    document.getElementById('back-btn3').addEventListener('click', () => {
        playerSetupMenu.classList.add('hidden');
        if (isMultiplayer) multiplayerMenu.classList.remove('hidden');
        else gameModeMenu.classList.remove('hidden');
    });

    // Emoji selectors
    document.querySelectorAll('.emoji-option').forEach(el => el.addEventListener('click', () => {
        const selector = el.closest('.emoji-selector, #emoji-picker')?.closest('.emoji-selector') || el.closest('[id$="menu"]');
        const grid = el.closest('.emoji-grid');
        if (grid) grid.querySelectorAll('.emoji-option').forEach(o => o.classList.remove('selected'));
        el.classList.add('selected');
        const input = el.closest('.menu, #join-room-panel')?.querySelector('input[type="hidden"]');
        if (input) input.value = el.dataset.emoji;
    }));

    // Play game
    playGameBtn.addEventListener('click', async () => {
        const name = document.getElementById('player-name').value.trim() || 'You';
        myPlayerName = name;
        const emoji = document.getElementById('player-emoji').value || '👤';
        playerSetupMenu.classList.add('hidden');
        loadCardImages();
        if (menuBackground) menuBackground.hide();

        if (!isMultiplayer) {
            gameContainer.classList.remove('hidden');
            if (isMobile()) fullscreenBtn.classList.remove('hidden');
            game = new UNOGame([
                { name, emoji, isBot: false },
                { name: 'Bot : 1', emoji: '🤖', isBot: true },
                { name: 'Bot : 2', emoji: '👾', isBot: true },
                { name: 'Bot : 3', emoji: '👻', isBot: true },
                { name: 'Bot : 4', emoji: '🐉', isBot: true },
                { name: 'Bot : 5', emoji: '🚀', isBot: true }
            ]);
            myPlayerIndex = 0;
            lastAutoPlayTime = 0; // FIX: Reset autoPlay timer for new game
            gameRunning = true;
            gameLoop();
        } else {
            if (isHost) {
                hostPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
                myPlayerId = hostPlayerId;
                myPlayerIndex = 0;
                const initialPlayers = [{ name, emoji, isBot: false, id: hostPlayerId, ready: true, isHost: true, deviceId, authUID: currentAuthUID || null }];
                game = new UNOGame(initialPlayers);
                const initialState = game.serialize();
                await createRoom(currentRoomCode, { ...initialState, players: initialPlayers, gameStarted: false });
                waitingRoomMenu.classList.remove('hidden');
                document.getElementById('waiting-room-code').textContent = currentRoomCode;
                document.getElementById('start-multiplayer-btn').classList.remove('hidden');
                document.getElementById('waiting-msg').textContent = "Waiting for players to join...";
                setupMultiplayerSubscription();
                initializeChatSystem();
            }
        }
    });

    // Color chooser
    document.querySelectorAll('.color-option').forEach(el => el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!game || !game.waitingForColor) return;
        const chosenColor = el.dataset.color;
        game.chosenColor = chosenColor;
        game.waitingForColor = false;
        hideColorChooser();
        updateColorGlow(chosenColor);
        // FIX: Reset autoPlay timer when color is chosen
        lastAutoPlayTime = 0;
        const currentP = game.getCurrentPlayer();
        game.finishTurn(game.currentPlayerIndex, currentP);
    }));

    // UNO button
    unoActionBtn.addEventListener('click', () => {
        if (!game || game.gameOver) return;
        const p = game.players[myPlayerIndex];
        const isMyTurn = game.currentPlayerIndex === myPlayerIndex;
        let hasPlayableCard = false;
        p.hand.forEach(c => {
            if (game.isValidMove(c)) hasPlayableCard = true;
        });

        if ((p.hand.length === 2 && isMyTurn && hasPlayableCard) || p.hand.length === 1) {
            p.unoCalled = true;
            game.broadcastAlert(`${p.name.toUpperCase()} CALLED UNO!`);
            if (isMultiplayer) game.syncState();
        } else {
            showAlert("Can only call UNO with 1 card left, or 2 cards and a playable card on your turn!");
        }
    });

    // Catch UNO
    catchUnoBtn.addEventListener('click', () => {
        if (!game || game.gameOver) return;
        let caughtCount = 0;
        let caughtNames = [];
        game.players.forEach((p, idx) => {
            const isTheirTurn = game.currentPlayerIndex === idx;
            if (p.hand.length === 1 && !p.unoCalled && !p.eliminated && !isTheirTurn) {
                for (let j = 0; j < 2; j++) p.addCard(game.safeDraw());
                caughtCount++;
                caughtNames.push(p.name.toUpperCase());
            }
        });
        if (caughtCount > 0) {
            game.broadcastAlert(`CAUGHT ${caughtNames.join(', ')}! +2 CARDS EACH!`);
            if (isMultiplayer) game.syncState();
        } else {
            showAlert("Nobody to catch!");
        }
    });

    // Fullscreen
    if (exitFullscreenBtn) exitFullscreenBtn.addEventListener('click', exitFullscreen);
    if (fullscreenBtn) fullscreenBtn.addEventListener('click', () => {
        if (document.fullscreenElement || document.webkitFullscreenElement) exitFullscreen();
        else requestFullscreen();
    });

    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) gameContainer.classList.remove('fullscreen'); });
    document.addEventListener('webkitfullscreenchange', () => { if (!document.webkitFullscreenElement) gameContainer.classList.remove('fullscreen'); });
}

function updateWaitingList(players) {
    const list = document.getElementById('waiting-players-list');
    if (!list) return;
    list.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        const statusClass = p.ready ? 'is-ready' : 'not-ready';
        li.innerHTML = `<div class="player-info-tag"><span>${p.emoji}</span> <strong>${p.name}</strong></div><span class="ready-status ${statusClass}">${p.ready ? 'READY' : 'WAITING'}</span>`;
        list.appendChild(li);
    });
}

function setupMultiplayerSubscription() {
    subscribeToRoom(currentRoomCode, (newState) => {
        if (!newState) return;

        // Track current timestamp for all players (update their last seen time)
        const now = Date.now();
        if (newState.players) {
            newState.players.forEach(p => {
                // Detect reconnection: player was disconnected but now has disconnected:false
                if (playerDisconnectTimers[p.id] && !p.disconnected && !p.eliminated) {
                    clearTimeout(playerDisconnectTimers[p.id].timeout);
                    delete playerDisconnectTimers[p.id];
                    // Update local game player to no longer be disconnected
                    if (game && game.players) {
                        const localP = game.players.find(lp => lp.id === p.id);
                        if (localP) { localP.disconnected = false; localP.isBot = false; }
                    }
                    if (gameRunning) showAlert(`✅ ${p.name} reconnected! Their hand is restored.`);
                } else if (!p.disconnected) {
                    lastPlayerUpdateTimes[p.id] = now;
                }
            });
        }

        // Host: detect newly-disconnected players, mark them in game state
        if (isHost && gameRunning && game && newState.gameStarted) {
            let stateChanged = false;
            newState.players.forEach(p => {
                if (p.eliminated || p.isBot || p.disconnected) return; // Skip already-handled
                // We rely on Supabase presence / heartbeat absence — use lastPlayerUpdateTimes
                // Host itself always updates; skip self
                if (p.id === hostPlayerId) { lastPlayerUpdateTimes[p.id] = now; return; }
                
                const lastSeen = lastPlayerUpdateTimes[p.id] || now;
                const timeSinceUpdate = now - lastSeen;
                
                // After 8 seconds without a state update from this player, mark disconnected
                if (timeSinceUpdate > 8000 && !playerDisconnectTimers[p.id]) {
                    playerDisconnectTimers[p.id] = {
                        startTime: now,
                        lastNotified: now,
                        timeout: null
                    };
                    // Mark player as disconnected in local game state
                    if (game.players) {
                        const localP = game.players.find(lp => lp.id === p.id);
                        if (localP) { localP.disconnected = true; }
                    }
                    stateChanged = true;
                    showAlert(`⚠️ ${p.name} disconnected. Playing their turns automatically. They have 90s to rejoin.`);
                }
                
                if (playerDisconnectTimers[p.id]) {
                    const disconnectTime = now - playerDisconnectTimers[p.id].startTime;
                    const timeRemaining = Math.max(0, RECONNECT_TIMEOUT_MS - disconnectTime);
                    
                    // Notify every 30 seconds
                    if (now - playerDisconnectTimers[p.id].lastNotified > 30000) {
                        notifyReconnectionAttempt(p.name, timeRemaining);
                        playerDisconnectTimers[p.id].lastNotified = now;
                    }
                    
                    // Eliminate player if timeout exceeded
                    if (disconnectTime > RECONNECT_TIMEOUT_MS) {
                        removeDisconnectedPlayer(p.id);
                        stateChanged = false; // removeDisconnectedPlayer calls syncState
                    }
                }
            });
            // Push disconnected flag changes to all clients
            if (stateChanged && game) game.syncState();
        }

        // Update waiting room UI
        if (newState.players) updateWaitingList(newState.players);

        // Sync myPlayerIndex by ID
        const foundIdx = newState.players.findIndex(p => p.id === (isHost ? hostPlayerId : myPlayerId));
        if (foundIdx !== -1) myPlayerIndex = foundIdx;

        // Host management in lobby
        if (isHost && !newState.gameStarted) {
            const others = newState.players.filter(p => p.id !== hostPlayerId);
            const allReady = others.length > 0 && others.every(p => p.ready);
            const startBtn = document.getElementById('start-multiplayer-btn');
            if (startBtn) startBtn.disabled = !allReady;
            const waitMsg = document.getElementById('waiting-msg');
            if (waitMsg) {
                if (others.length === 0) waitMsg.textContent = "Waiting for players to join...";
                else if (!allReady) waitMsg.textContent = "Waiting for all players to be ready...";
                else waitMsg.textContent = "✅ Everyone is ready! You can start.";
            }
            // Keep host's game player list in sync
            if (game) game.players = newState.players.map(p => new Player(p.name, p.emoji, p.isBot, p.id, false, p.deviceId, p.authUID));
        }

        // Game start for non-host (initial start OR new round)
        if (newState.gameStarted && !newState.gameOver) {
            // Detect new round: game was running and was over, now it's not
            const isNewRound = gameRunning && game && game.gameOver && !newState.gameOver;
            const isFirstStart = !gameRunning;
            
            if (isFirstStart || isNewRound) {
                if (isFirstStart) {
                    waitingRoomMenu.classList.add('hidden');
                    gameContainer.classList.remove('hidden');
                    if (menuBackground) menuBackground.hide();
                    if (isMobile()) fullscreenBtn.classList.remove('hidden');
                }
                
                if (isNewRound) {
                    // Close the game-over modal for the new round
                    gameOverModal.classList.add('hidden');
                }

                const makeCard = (c) => c ? new Card(c.color, c.value, c.filename) : null;
                
                // Ensure authUID is preserved for all players
                const playersWithAuth = newState.players.map(p => ({
                    name: p.name,
                    emoji: p.emoji,
                    isBot: p.isBot || false,
                    id: p.id,
                    isHost: p.isHost || false,
                    deviceId: p.deviceId || null,
                    authUID: p.authUID || null,
                    hand: p.hand,
                    eliminated: p.eliminated || false,
                    unoCalled: p.unoCalled || false
                }));
                
                game = new UNOGame(playersWithAuth, newState.scores || {});
                game.deck = newState.deck.map(makeCard).filter(Boolean);
                game.discardPile = newState.discardPile.map(makeCard).filter(Boolean);
                game.currentPlayerIndex = newState.currentPlayerIndex;
                game.gameDirection = newState.gameDirection;
                game.chosenColor = newState.chosenColor;
                game.stackPenalty = newState.stackPenalty;
                game.gameOver = newState.gameOver;
                game.waitingForColor = newState.waitingForColor;
                game.scores = newState.scores || {};
                game.nextRoundReadySet = {};
                lastAutoPlayTime = 0;

                // Sync player hands and restore any eliminated status
                game.players.forEach((local, idx) => {
                    const p = newState.players[idx];
                    if (p) {
                        local.hand = p.hand.map(makeCard).filter(Boolean);
                        local.eliminated = p.eliminated || false;
                        local.unoCalled = p.unoCalled || false;
                    }
                });

                const me = game.players.findIndex(p => p.id === myPlayerId);
                if (me !== -1) myPlayerIndex = me;

                updateColorGlow(game.chosenColor);

                // Show color chooser if needed for this player
                if (newState.waitingForColor && newState.waitingPlayerId === myPlayerId) {
                    colorChooserVisible = true;
                    showColorChooser();
                }

                // Update the lastSyncedState so applyRemoteState doesn't skip
                lastSyncedState = newState.lastUpdate;

                if (!gameRunning) {
                    gameRunning = true;
                    gameLoop();
                    // Non-host: start heartbeat so host knows we're alive
                    if (!isHost) startHeartbeat();
                }
            }
        }

        // Live game state sync
        if (gameRunning && newState.gameStarted && game) {
            applyRemoteState(newState);
        }
    });
}

// ===== CANVAS INTERACTION =====
gameCanvas.addEventListener('mousemove', (e) => {
    if (!game || game.currentPlayerIndex !== myPlayerIndex || game.waitingForColor || game.gameOver) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = gameCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr;
    hoveredCardIndex = humanCardBounds.findLastIndex(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
    gameCanvas.style.cursor = hoveredCardIndex >= 0 ? 'pointer' : 'default';
});

gameCanvas.addEventListener('click', (e) => {
    if (!game || game.currentPlayerIndex !== myPlayerIndex || game.gameOver || game.waitingForColor) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = gameCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * dpr, my = (e.clientY - rect.top) * dpr;

    if (game.waitingForSwap) {
        const clickedOpp = opponentBounds.find(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
        if (clickedOpp) {
            // FIX: Use game.currentPlayerIndex (authoritative turn index) instead of myPlayerIndex (local player index)
            game.swapHands(game.currentPlayerIndex, clickedOpp.pIdx);
            game.waitingForSwap = false;
            game.finishTurn(game.currentPlayerIndex, game.players[game.currentPlayerIndex]);
        }
        return;
    }

    const clickedIdx = humanCardBounds.findLastIndex(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);

    if (clickedIdx >= 0) {
        const card = game.players[myPlayerIndex].hand[clickedIdx];
        if (card && game.isValidMove(card, clickedIdx)) {
            game.playCard(myPlayerIndex, clickedIdx, false);
            hoveredCardIndex = -1;
        } else {
            showAlert("Can't play that card!");
        }
    } else {
        // Click on deck area
        const cx = gameCanvas.width / 2;
        const tableAreaMid = (70 * SCALE + gameCanvas.height - CARD_H - 80 * SCALE) / 2;
        const deckY = tableAreaMid - CARD_H / 2;
        const deckX = cx - CARD_W - 15 * SCALE;
        if (mx >= deckX && mx <= deckX + CARD_W && my >= deckY && my <= deckY + CARD_H) {
            if (game.hasDrawnThisTurn) {
                game.nextTurn();
                game.syncState();
            } else {
                game.drawCard();
            }
        }
    }
});

gameCanvas.addEventListener('wheel', (e) => {
    if (!game) return;
    e.preventDefault();
    
    // Optimize scrolling with throttling on mobile
    isScrolling = true;
    if (scrollThrottleTimer) clearTimeout(scrollThrottleTimer);
    scrollThrottleTimer = setTimeout(() => { isScrolling = false; }, 150);
    
    const p = game.players[myPlayerIndex];
    const n = p.hand.length;
    const mobileLandscape = isMobile() && !isPortrait();
    const hScale = mobileLandscape ? 1.4 : 1;
    const hCW = CARD_W * hScale;
    
    const maxHandW = Math.min(gameCanvas.width - 80 * SCALE, hCW * 10);
    const cardSpacing = Math.min(hCW * 1.1, Math.max(hCW * 0.55, (maxHandW - hCW) / Math.max(n - 1, 1)));
    const totalWidth = (n - 1) * cardSpacing + hCW;
    if (totalWidth > maxHandW) {
        const dpr = window.devicePixelRatio || 1;
        // Reduce scroll sensitivity on mobile for smoother control
        const scrollAmount = isMobile() ? 0.3 : 0.5;
        handScrollX -= e.deltaY * scrollAmount * dpr;
        handScrollX = Math.max(maxHandW - totalWidth, Math.min(0, handScrollX));
    }
}, { passive: false });

// Touch support
let touchStartX = 0, touchStartY = 0, initialScrollX = 0, isScrollingHand = false, touchStartTime = 0;

gameCanvas.addEventListener('touchstart', (e) => {
    const touch = e.touches[0];
    const dpr = window.devicePixelRatio || 1;
    const rect = gameCanvas.getBoundingClientRect();
    touchStartX = (touch.clientX - rect.left) * dpr;
    touchStartY = (touch.clientY - rect.top) * dpr;
    initialScrollX = handScrollX;
    isScrollingHand = false;
    touchStartTime = Date.now();
    if (!game) return;
    const baseY = gameCanvas.height - CARD_H - 80 * SCALE;
    if (touchStartY > baseY - 40 * SCALE) {
        const p = game.players[myPlayerIndex];
        const n = p.hand.length;
        const mobileLandscape = isMobile() && !isPortrait();
        const hScale = mobileLandscape ? 1.4 : 1;
        const hCW = CARD_W * hScale;
        
        const maxHandW = Math.min(gameCanvas.width - 80 * SCALE, hCW * 10);
        const cardSpacing = Math.min(hCW * 1.1, Math.max(hCW * 0.55, (maxHandW - hCW) / Math.max(n - 1, 1)));
        const totalWidth = (n - 1) * cardSpacing + hCW;
        isScrollingHand = totalWidth > maxHandW;
    }
}, { passive: true });

gameCanvas.addEventListener('touchmove', (e) => {
    if (!game) return;
    const touch = e.touches[0];
    if (isScrollingHand) {
        const dpr = window.devicePixelRatio || 1;
        const rect = gameCanvas.getBoundingClientRect();
        const deltaX = (touch.clientX - rect.left) * dpr - touchStartX;
        const p = game.players[myPlayerIndex];
        const n = p.hand.length;
        const mobileLandscape = isMobile() && !isPortrait();
        const hScale = mobileLandscape ? 1.4 : 1;
        const hCW = CARD_W * hScale;
        
        const maxHandW = Math.min(gameCanvas.width - 80 * SCALE, hCW * 10);
        const cardSpacing = Math.min(hCW * 1.1, Math.max(hCW * 0.55, (maxHandW - hCW) / Math.max(n - 1, 1)));
        const totalWidth = (n - 1) * cardSpacing + hCW;
        handScrollX = initialScrollX + deltaX;
        handScrollX = Math.max(maxHandW - totalWidth, Math.min(0, handScrollX));
    }
}, { passive: true });

gameCanvas.addEventListener('touchend', (e) => {
    if (isScrollingHand) { isScrollingHand = false; return; }
    if (!game || game.currentPlayerIndex !== myPlayerIndex || game.waitingForColor || game.gameOver) return;

    const touch = e.changedTouches[0];
    const dpr = window.devicePixelRatio || 1;
    const rect = gameCanvas.getBoundingClientRect();
    const tx = (touch.clientX - rect.left) * dpr;
    const ty = (touch.clientY - rect.top) * dpr;
    const dx = Math.abs(tx - touchStartX);
    const dy = Math.abs(ty - touchStartY);
    const elapsed = Date.now() - touchStartTime;

    // Only register as tap if it wasn't a drag
    if (dx > 10 * dpr || dy > 10 * dpr || elapsed > 400) return;

    const mx = tx;
    const my = ty;

    if (game.waitingForSwap) {
        const clickedOpp = opponentBounds.find(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
        if (clickedOpp) {
            game.swapHands(myPlayerIndex, clickedOpp.pIdx);
            game.waitingForSwap = false;
            game.finishTurn(myPlayerIndex, game.players[myPlayerIndex]);
        }
        return;
    }

    const clickedIdx = humanCardBounds.findLastIndex(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);

    if (clickedIdx >= 0) {
        const card = game.players[myPlayerIndex].hand[clickedIdx];
        if (card && game.isValidMove(card, clickedIdx)) {
            game.playCard(myPlayerIndex, clickedIdx, false);
        } else {
            showAlert("Can't play that card!");
        }
    } else {
        // Tap on deck
        const cx = gameCanvas.width / 2;
        const tableAreaMid = (70 * SCALE + gameCanvas.height - CARD_H - 80 * SCALE) / 2;
        const deckY = tableAreaMid - CARD_H / 2;
        const deckX = cx - CARD_W - 15 * SCALE;
        if (mx >= deckX && mx <= deckX + CARD_W && my >= deckY && my <= deckY + CARD_H) {
            if (game.hasDrawnThisTurn) {
                game.nextTurn();
                game.syncState();
            } else {
                game.drawCard();
            }
        }
    }
}, { passive: true });

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    loadCardImages();
    initGameUI();
    menuBackground = new MenuBackground();
});

// ===== PLAYER HEARTBEAT (non-host only) =====
// Sends a lightweight presence ping every 5 seconds so the host
// knows this player is still connected. Uses a dedicated Supabase
// channel broadcast to avoid mutating room state needlessly.
let heartbeatInterval = null;

function startHeartbeat() {
    stopHeartbeat();
    if (!isMultiplayer || isHost || !currentRoomCode || !myPlayerId || !supabase) return;
    heartbeatInterval = setInterval(async () => {
        if (!gameRunning || !currentRoomCode || !myPlayerId) { stopHeartbeat(); return; }
        try {
            // Broadcast a tiny ping on a presence channel
            await supabase
                .channel(`heartbeat:${currentRoomCode}`)
                .send({ type: 'broadcast', event: 'ping', payload: { playerId: myPlayerId, ts: Date.now() } });
        } catch (_) { /* ignore send errors */ }
    }, 4000);
}

function stopHeartbeat() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
}

// Host listens to heartbeat pings and updates lastPlayerUpdateTimes
function setupHeartbeatListener() {
    if (!isHost || !currentRoomCode || !supabase) return;
    supabase
        .channel(`heartbeat:${currentRoomCode}`)
        .on('broadcast', { event: 'ping' }, ({ payload }) => {
            if (payload && payload.playerId) {
                lastPlayerUpdateTimes[payload.playerId] = Date.now();
                // If this player was marked disconnected, clear that flag
                if (playerDisconnectTimers[payload.playerId] && game && game.players) {
                    const localP = game.players.find(p => p.id === payload.playerId);
                    if (localP && localP.disconnected) {
                        localP.disconnected = false;
                        clearTimeout(playerDisconnectTimers[payload.playerId].timeout);
                        delete playerDisconnectTimers[payload.playerId];
                        game.syncState();
                    }
                }
            }
        })
        .subscribe();
}

// ===== CLEANUP ON PAGE LEAVE =====
window.addEventListener('beforeunload', () => {
    stopHeartbeat();
});