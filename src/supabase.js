// Supabase Configuration
const SUPABASE_URL = 'https://tykyiwkotfhyhxvkrcdo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5a3lpd2tvdGZoeWh4dmtyY2RvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczODM2MjMsImV4cCI6MjA5Mjk1OTYyM30.lshldbmHP0n8ZC7HklMz1T_x_S1KlDSn281Cyo73LNs';

export const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// ===== SUPABASE AUTHENTICATION =====
export async function signInWithGoogle() {
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        console.log('Starting Google OAuth sign-in...');
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/`,
                queryParams: {
                    access_type: 'offline',
                    prompt: 'consent'
                }
            }
        });
        if (error) {
            console.error('Google OAuth error:', error);
            throw error;
        }
        console.log('Google OAuth initiated, redirecting...');
        return { success: true, data };
    } catch (error) {
        console.error('Google sign-in error:', error);
        return { success: false, error: `Google sign-in failed: ${error.message}. Make sure Google OAuth is enabled in Supabase project settings.` };
    }
}

// Format and validate phone number in E.164 format
function formatPhoneNumber(phone) {
    // Remove all non-digit characters except +
    let cleaned = phone.replace(/[^\d+]/g, '');
    
    // If it doesn't start with +, add country code
    if (!cleaned.startsWith('+')) {
        // Assume Bangladesh if no country code
        if (cleaned.length <= 11) {
            cleaned = '+880' + cleaned.replace(/^0+/, ''); // Remove leading zeros, add +880
        } else {
            cleaned = '+' + cleaned;
        }
    }
    
    return cleaned;
}

export async function signInWithPhone(phone) {
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`Sending OTP to ${formattedPhone}...`);
        
        if (!/^\+\d{10,15}$/.test(formattedPhone)) {
            return { success: false, error: 'Invalid phone format. Use +880XXXXXXXXXX for Bangladesh or +[country code][number]' };
        }
        
        const { data, error } = await supabase.auth.signInWithOtp({
            phone: formattedPhone
        });
        if (error) throw error;
        return { success: true, data, phone: formattedPhone };
    } catch (error) {
        console.error('Phone OTP error:', error);
        return { success: false, error: `Phone sign-in failed: ${error.message}. Use format: +880XXXXXXXXXX (for Bangladesh) or +[country code][number]` };
    }
}

export async function verifyPhoneOtp(phone, token) {
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const formattedPhone = formatPhoneNumber(phone);
        console.log(`Verifying OTP for ${formattedPhone}...`);
        
        const { data, error } = await supabase.auth.verifyOtp({
            phone: formattedPhone,
            token,
            type: 'sms'
        });
        if (error) throw error;
        return { success: true, data };
    } catch (error) {
        console.error('Phone OTP verification error:', error);
        return { success: false, error: `OTP verification failed: ${error.message}` };
    }
}

export async function signOut() {
    if (!supabase) return { success: false, error: 'Supabase not initialized' };
    try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        return { success: true };
    } catch (error) {
        console.error('Sign out error:', error);
        return { success: false, error: error.message };
    }
}

export function getCurrentUser() {
    return supabase?.auth?.getUser() || null;
}

export function onAuthStateChanged(callback) {
    if (!supabase) return;
    return supabase.auth.onAuthStateChange((event, session) => {
        callback(session?.user || null);
    });
}

export async function createRoom(roomCode, initialState) {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('rooms')
        .insert([{ code: roomCode, state: initialState }])
        .select();
    if (error) {
        console.error('Error creating room:', error);
        return null;
    }
    return data[0];
}

export async function joinRoom(roomCode) {
    if (!supabase) return null;
    const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', roomCode)
        .maybeSingle();
    if (error) {
        console.error('Error joining room:', error);
        return null;
    }
    return data;
}

export async function updateRoomState(roomCode, newState) {
    if (!supabase) return;
    const { error } = await supabase
        .from('rooms')
        .update({ state: newState, last_action_at: new Date() })
        .eq('code', roomCode);
    if (error) console.error('Error updating state:', error);
}

export function subscribeToRoom(roomCode, callback) {
    if (!supabase) return;
    return supabase
        .channel(`room:${roomCode}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `code=eq.${roomCode}` }, 
            payload => callback(payload.new.state))
        .subscribe();
}
