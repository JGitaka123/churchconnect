// Church 2.0 - API client for the production backend.
//
// When window.CHURCH2_CONFIG.apiBase is set, this talks to the real API
// (auth + shared Postgres data). When it's empty, isEnabled() returns false and
// the app runs in standalone localStorage demo mode. All calls are gated on
// isEnabled() so the static demo keeps working with no backend.
(function () {
  'use strict';

  const TOKEN_KEY = 'church2_token';

  const base = () => (window.CHURCH2_CONFIG && window.CHURCH2_CONFIG.apiBase) || '';
  // When the app is served by the backend (port 4000), relative /api calls are same-origin.
  const sameOriginApi = () => typeof window !== 'undefined' && window.location.port === '4000';
  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const url = base() + '/api' + path;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new Error(`Cannot reach backend at ${url} from page ${window.location.origin} - is the API server running? (${e.message})`);
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const scoped = (path, branch) => {
    if (!branch || branch === 'global') return path;
    return path + (path.includes('?') ? '&' : '?') + 'branch=' + encodeURIComponent(branch);
  };

  window.Church2API = {
    isEnabled: () => Boolean(base()) || sameOriginApi(),
    getToken,
    // Revokes the server-side session (best effort) and clears the local token.
    async logout() {
      try { await request('POST', '/auth/logout', {}); } catch (e) { /* token may already be invalid */ }
      setToken(null);
    },
    // Revokes every session for the account on the server.
    async logoutAll() { return request('POST', '/auth/logout-all', {}); },

    // ---- Auth ----
    async login(email, password) {
      return request('POST', '/auth/login', { email, password }); // -> {mfaRequired,ticket} | {token,user}
    },
    async verifyMfa(ticket, code) {
      const r = await request('POST', '/auth/mfa', { ticket, code });
      if (r.token) setToken(r.token);
      return r; // {token,user}
    },
    // Ask the server to email/text a fresh 6-digit code (non-prod may return debugCode).
    async requestMfaCode(ticket, method) {
      return request('POST', '/auth/mfa/request', { ticket, method }); // -> {ok} | {ok, debugCode}
    },
    // Toggle MFA + update the SMS phone for the signed-in user (members only).
    async mfaSettings(enabled, phone) {
      return request('POST', '/auth/mfa/settings', { enabled, phone });
    },
    // ---- Account security ----
    // Active sessions for the signed-in user + revoke one / all.
    async sessions() { return request('GET', '/auth/sessions'); },
    async revokeSession(id) { return request('POST', '/auth/sessions/' + encodeURIComponent(id) + '/revoke', {}); },
    async changePassword(currentPassword, newPassword) {
      return request('POST', '/auth/change-password', { currentPassword, newPassword });
    },
    // Returns a short-lived reauthToken that unlocks sensitive operations.
    async reauthenticate(password) { return request('POST', '/auth/reauthenticate', { password }); },
    // Generate 10 fresh single-use recovery codes (requires password/reauth).
    async recoveryCodes(password, reauthToken) {
      return request('POST', '/auth/recovery-codes', { password, reauthToken });
    },
    // Authenticator app (TOTP).
    async setupTotp() { return request('POST', '/auth/totp/setup', {}); },
    async verifyTotp(code) { return request('POST', '/auth/totp/verify', { code }); },
    async disableTotp(password, reauthToken) { return request('POST', '/auth/totp/disable', { password, reauthToken }); },
    // Forgot / reset password (enumeration-safe; dev returns debugCode).
    async forgotPassword(email) { return request('POST', '/auth/forgot-password', { email }); },
    async resetPassword(email, code, password) {
      return request('POST', '/auth/reset-password', { email, code, password });
    },
    async completePasswordLogin(r) {
      if (r && r.token) setToken(r.token);
      return r;
    },
    async me() { return request('GET', '/auth/me'); },
    // Public campus list (used by the registration form before sign-in).
    async branchesPublic() { return request('GET', '/auth/branches'); },
    // Self-service registration -> {token, user}. Signs the user in on success.
    async register(account) { return request('POST', '/auth/register', account); },

    // ---- Resources (branch = active campus scope, or 'global') ----
    members: (branch, search) => request('GET', scoped('/members' + (search ? `?search=${encodeURIComponent(search)}` : ''), branch)),
    createMember: (m) => request('POST', '/members', m),
    transactions: (branch) => request('GET', scoped('/transactions', branch)),
    recordTransaction: (t) => request('POST', '/transactions', t),
    attendance: (branch) => request('GET', scoped('/attendance', branch)),
    setAttendance: (a) => request('PUT', '/attendance', a),
    dashboardSummary: (branch) => request('GET', scoped('/dashboard/summary', branch)),
    groups: (branch) => request('GET', scoped('/groups', branch)),
    createGroup: (g) => request('POST', '/groups', g),
    toggleGroupMember: (id, memberId) => request('POST', `/groups/${id}/toggle-member`, { memberId }),
    // Member app -> web Groups tab link: RSVP "Going" to an event, request to
    // join a small group, and the admin's approve/decline actions.
    rsvpEvent: (id, memberId, going) => request('POST', `/events/${encodeURIComponent(id)}/rsvp`, { memberId, going }),
    requestGroupJoin: (id, memberId, cancel) => request('POST', `/groups/${id}/join-request`, { memberId, cancel: Boolean(cancel) }),
    approveGroupRequest: (id, memberId) => request('POST', `/groups/${id}/approve-request`, { memberId }),
    // Admin posts a group announcement; the server notifies every member
    // over the chosen channels (email / WhatsApp) and it shows in the app.
    announceToGroup: (id, payload) => request('POST', `/groups/${encodeURIComponent(id)}/announce`, payload),
    declineGroupRequest: (id, memberId) => request('POST', `/groups/${id}/decline-request`, { memberId }),
    updateGroup: (id, g) => request('PUT', `/groups/${id}`, g),
    deleteGroup: (id) => request('DELETE', `/groups/${id}`),
    followups: (branch) => request('GET', scoped('/followups', branch)),
    createFollowup: (f) => request('POST', '/followups', f),
    moveFollowup: (id, stage) => request('PATCH', `/followups/${id}`, { stage }),
    deleteFollowup: (id) => request('DELETE', `/followups/${encodeURIComponent(id)}`),
    announcements: () => request('GET', '/announcements'),
    sendAnnouncement: (a) => request('POST', '/announcements', a),
    suggestAnnouncement: (a) => request('POST', '/announcements/suggest', a),
    approveAnnouncement: (id) => request('POST', '/announcements/' + id + '/approve'),
    rejectAnnouncement: (id, reason) => request('POST', '/announcements/' + id + '/reject', { reason }),
    prayerRequests: (branch) => request('GET', scoped('/prayer-requests', branch)),
    submitPrayer: (p) => request('POST', '/prayer-requests', p),
    dismissPrayer: (id) => request('DELETE', `/prayer-requests/${id}`),
    events: (branch) => request('GET', scoped('/events', branch)),
    createEvent: (e) => request('POST', '/events', e),
    updateEventVolunteers: (id, volunteerIds) => request('PUT', `/events/${encodeURIComponent(id)}/volunteers`, { volunteerIds }),
    updateEventRota: (id, data) => request('PUT', `/events/${encodeURIComponent(id)}/rota`, data),
    campaigns: (branch) => request('GET', scoped('/campaigns', branch)),
    createCampaign: (c) => request('POST', '/campaigns', c),
    updateCampaign: (id, patch) => request('PATCH', `/campaigns/${encodeURIComponent(id)}`, patch),
    deleteCampaign: (id) => request('DELETE', `/campaigns/${encodeURIComponent(id)}`),
    recurringGifts: (branch) => request('GET', scoped('/recurring-gifts', branch)),
    createRecurringGift: (g) => request('POST', '/recurring-gifts', g),
    careInbox: (branch) => request('GET', scoped('/care-inbox', branch)),
    postCareMessage: (m) => request('POST', '/care-inbox', m),
    updateCareMessage: (id, patch) => request('PATCH', `/care-inbox/${encodeURIComponent(id)}`, patch),
    deleteCareMessage: (id) => request('DELETE', `/care-inbox/${encodeURIComponent(id)}`),
    updateMember: (id, patch) => request('PATCH', `/members/${encodeURIComponent(id)}`, patch),
    deleteMember: (id) => request('DELETE', `/members/${encodeURIComponent(id)}`),
    // Ask the AI assistant (DeepSeek via the backend when configured).
    chat: (messages, system) => request('POST', '/v1/ai/chat', { messages, system }),

    // ---- Churches, branches & projects (multi-church) ----
    // Authenticated branch list, always scoped to the caller's church.
    branches: () => request('GET', '/v1/branches'),
    createBranch: (b) => request('POST', '/v1/branches', b),
    updateBranch: (id, patch) => request('PATCH', `/v1/branches/${encodeURIComponent(id)}`, patch),
    deleteBranch: (id) => request('DELETE', `/v1/branches/${encodeURIComponent(id)}`),
    churches: () => request('GET', '/v1/churches'),
    updateChurch: (id, patch) => request('PATCH', `/v1/churches/${encodeURIComponent(id)}`, patch),
  };
})();
