const API = {
  base: '/api',

  token() {
    return localStorage.getItem('mc_token');
  },

  setSession(token, user, role) {
    localStorage.setItem('mc_token', token);
    localStorage.setItem('mc_user', JSON.stringify(user));
    localStorage.setItem('mc_role', role);
  },

  clearSession() {
    localStorage.removeItem('mc_token');
    localStorage.removeItem('mc_user');
    localStorage.removeItem('mc_role');
  },

  currentUser() {
    const raw = localStorage.getItem('mc_user');
    return raw ? JSON.parse(raw) : null;
  },

  currentRole() {
    return localStorage.getItem('mc_role');
  },

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = this.token();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && !path.startsWith('/auth/login')) {
      this.clearSession();
      window.location.href = '/index.html';
      return null;
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  del(path) { return this.request('DELETE', path); },
};

function requireRole(expectedRole) {
  const role = API.currentRole();
  if (!API.token() || role !== expectedRole) {
    window.location.href = '/index.html';
  }
}

function logout() {
  API.clearSession();
  window.location.href = '/index.html';
}

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString();
}

function statusBadge(status) {
  return `<span class="badge ${status}">${status}</span>`;
}
