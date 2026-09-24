// notifications.js — Web Notification API wrapper & periodic reminder engine

const NotifEngine = {
  isSupported() {
    return 'Notification' in window;
  },

  permission() {
    return this.isSupported() ? Notification.permission : 'denied';
  },

  async requestPermission() {
    if (!this.isSupported()) {
      alert('Your browser does not support desktop notifications.');
      return false;
    }
    const perm = await Notification.requestPermission();
    this.updateUI();
    if (perm === 'granted') {
      this.notify('MediCare Notifications Enabled ✅', {
        body: 'You will now receive desktop alerts for medicine schedules and doctor messages.',
        icon: '/favicon.ico'
      });
      return true;
    }
    return false;
  },

  notify(title, options = {}) {
    if (!this.isSupported() || Notification.permission !== 'granted') {
      return null;
    }

    try {
      const notif = new Notification(title, {
        icon: 'https://cdn-icons-png.flaticon.com/512/883/883360.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/883/883360.png',
        ...options,
      });

      notif.onclick = function() {
        window.focus();
        notif.close();
      };

      return notif;
    } catch (e) {
      console.warn('Desktop notification failed:', e);
      return null;
    }
  },

  updateUI() {
    const btn = document.getElementById('btnEnablePush');
    if (!btn) return;

    if (!this.isSupported()) {
      btn.style.display = 'none';
      return;
    }

    if (Notification.permission === 'granted') {
      btn.textContent = '🔔 Alerts Active';
      btn.classList.remove('primary');
      btn.classList.add('secondary');
      btn.title = 'Desktop notifications are active';
      btn.disabled = true;
    } else if (Notification.permission === 'denied') {
      btn.textContent = '🔕 Alerts Blocked';
      btn.title = 'Notifications are blocked in your browser settings';
      btn.disabled = true;
    } else {
      btn.textContent = '🔔 Enable Push Alerts';
      btn.classList.add('primary');
      btn.classList.remove('secondary');
      btn.disabled = false;
    }
  }
};

window.NotifEngine = NotifEngine;
