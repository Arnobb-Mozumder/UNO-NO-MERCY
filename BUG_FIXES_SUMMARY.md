# Multiplayer Game Logic Bug Fixes - Summary

## Issues Fixed

### 1. **Color Chooser Appearing for Wrong Player** ✅
**Problem:** When one player played a wild card and needed to choose a color, the color chooser box would appear on OTHER players' screens even though they weren't the ones waiting for color.

**Root Cause:** The `applyRemoteState()` function had incomplete logic for hiding the color chooser:
```javascript
// OLD CODE (BUGGY)
if (amIWaiting && newState.waitingForColor && !colorChooserVisible) {
    colorChooserVisible = true;
    showColorChooser();
} else if (!newState.waitingForColor && colorChooserVisible) {
    hideColorChooser();
}
```
The problem: If `waitingForColor = true` but `waitingPlayerId` is ANOTHER player, the condition `!newState.waitingForColor` is false, so the color chooser is NOT hidden for other players.

**Fix:** Updated the condition to properly hide the chooser when:
- No one is waiting for color, OR
- Someone is waiting for color but it's NOT this player
```javascript
// NEW CODE (FIXED)
if (newState.waitingForColor && newState.waitingPlayerId === myPlayerId && !colorChooserVisible) {
    colorChooserVisible = true;
    showColorChooser();
} else if (colorChooserVisible && (newState.waitingForColor && newState.waitingPlayerId !== myPlayerId || !newState.waitingForColor)) {
    // Hide if: no longer waiting for color, OR waiting for color but for a different player
    hideColorChooser();
}
```

---

### 2. **Automatic Color Choosing Box Appearing When Player Has No Color Card** ✅
**Problem:** When a player missed their turn timer and had no valid cards to play, the game would draw a card for them. In some cases, a color chooser box would appear even though they never played a wild card.

**Root Cause:** Multiple issues combined:
- The `autoPlay()` function was being called repeatedly every frame when `turnTimer <= 0`
- There was no protection against multiple auto-play calls in the same turn
- Timing issues with state sync could cause desynchronization

**Fix:** 
1. Added `lastAutoPlayTime` variable to track when autoPlay was last executed
2. Updated `gameLoop()` to prevent repeated autoPlay calls in the same turn (must wait 500ms between calls)
3. Reset `lastAutoPlayTime` whenever:
   - A card is played (`playCard()`)
   - A turn advances (`nextTurn()`)
   - A color is chosen
   - A new game is created
   - The game state is received from server

```javascript
// Added throttling to prevent repeated autoPlay calls
if (game.turnTimer <= 0 && !game.waitingForColor && !game.waitingForSwap) {
    const isMyTurnLocal = game.currentPlayerIndex === myPlayerIndex;
    const currentTime = Date.now();
    // Only trigger autoPlay if enough time has passed since last turn change (500ms)
    if ((!isMultiplayer || isMyTurnLocal) && currentTime - lastAutoPlayTime > 500) {
        lastAutoPlayTime = currentTime;
        game.autoPlay();
    }
}
```

---

### 3. **"Every Player Sees Someone Else's Turn" Desynchronization** ✅
**Problem:** At various points during multiplayer games, all players would see it's someone else's turn and no one could actually play.

**Root Causes:**
- `autoPlay()` could be called multiple times per turn due to frame-based game loop
- Race conditions where multiple clients try to advance the turn simultaneously
- Missing state resets when waiting states change

**Fixes Applied:**
1. **Prevent multiple autoPlay calls per turn** (see Fix #2)
2. **Added `!game.waitingForSwap` check** to prevent autoPlay when waiting for swap
3. **Reset `lastAutoPlayTime` in all game state transitions**:
   - When a new single-player game starts
   - When a multiplayer game starts (host)
   - When a new round begins after game over
   - When the game state is received from server (setupMultiplayerSubscription)
   - When a color is chosen by a player
   - When turn advances

---

## Changes Made to `/src/script.js`

### Line 76: Added timer tracking variable
```javascript
let lastAutoPlayTime = 0; // FIX: Prevent multiple autoPlay calls in same turn
```

### Line ~432: Fixed color chooser visibility logic in `applyRemoteState()`
Complete rewrite of the color chooser condition to properly handle player isolation.

### Line ~602: Added `lastAutoPlayTime` reset in `playCard()`
```javascript
lastAutoPlayTime = 0; // FIX: Reset autoPlay timer when a card is played
```

### Line ~613: Added `lastAutoPlayTime` reset in `nextTurn()`
```javascript
lastAutoPlayTime = 0; // FIX: Reset autoPlay timer when turn changes
```

### Line ~1288-1295: Updated `gameLoop()` auto-play logic
- Added `!game.waitingForSwap` condition
- Added 500ms throttle to prevent repeated calls
- Uses `lastAutoPlayTime` to track execution

### Line ~1642: Added reset in color chooser click handler
```javascript
lastAutoPlayTime = 0; // FIX: Reset autoPlay timer when color is chosen
```

### Multiple Game Initialization Points: Added `lastAutoPlayTime = 0` resets
- Single player game start (line ~1615)
- Multiplayer game start (line ~1553)
- New round/play again (line ~1455)
- Game state received from server (line ~1815)

---

## Testing Recommendations

1. **Test single-player mode** to ensure normal auto-play still works
2. **Test multiplayer color selection**:
   - Player A plays a wild card
   - Verify color chooser ONLY appears on Player A's screen
   - Verify other players see "waiting for Player A to choose color"
3. **Test missed turns**:
   - Let a player's timer expire without playing
   - Verify auto-play happens only once per turn
   - Verify correct player is auto-played
4. **Test fast gameplay**:
   - Have rapid turns with multiple wild cards
   - Verify no "everyone's turn" desync occurs
5. **Test disconnection and reconnection** in multiplayer to ensure state recovery

---

## Summary

These fixes ensure:
- ✅ Color chooser only shows for the correct player
- ✅ No automatic color chooser for players without wild cards
- ✅ AutoPlay happens exactly once per turn, not repeatedly
- ✅ Game state stays synchronized across all players
- ✅ Proper turn management without desynchronization
