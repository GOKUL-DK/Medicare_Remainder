// accountModal.js — Shared account settings & password change dialog

function openPasswordModal() {
  let modal = document.getElementById('passwordModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'passwordModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width:440px;">
        <div class="modal-header">
          <h3>🔒 Account Settings</h3>
          <button class="modal-close" onclick="closePasswordModal()">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:13px; color:var(--text-muted); margin-top:0 0 16px 0;">
            Update your account password. Must be at least 6 characters.
          </p>
          <div id="pwErr" class="error" style="display:none; margin-bottom:12px;"></div>
          <div id="pwSuccess" style="display:none; color:var(--primary); background:var(--primary-light); padding:10px; border-radius:6px; font-size:13px; font-weight:600; margin-bottom:12px; text-align:center;"></div>
          <form onsubmit="submitPasswordChange(event)">
            <div class="form-group">
              <label>Current Password</label>
              <input type="password" id="oldPw" placeholder="Enter current password" required>
            </div>
            <div class="form-group">
              <label>New Password</label>
              <input type="password" id="newPw" placeholder="Enter new password (min 6 chars)" required minlength="6">
            </div>
            <div class="form-group">
              <label>Confirm New Password</label>
              <input type="password" id="confirmPw" placeholder="Re-enter new password" required minlength="6">
            </div>
            <div class="modal-footer" style="padding:0; border:none; margin-top:8px;">
              <button type="button" class="secondary" onclick="closePasswordModal()">Cancel</button>
              <button type="submit" class="primary">🔒 Update Password</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  document.getElementById('oldPw').value = '';
  document.getElementById('newPw').value = '';
  document.getElementById('confirmPw').value = '';
  document.getElementById('pwErr').style.display = 'none';
  document.getElementById('pwSuccess').style.display = 'none';
  modal.classList.add('open');
}

function closePasswordModal() {
  const modal = document.getElementById('passwordModal');
  if (modal) modal.classList.remove('open');
}

async function submitPasswordChange(e) {
  e.preventDefault();
  const oldPw = document.getElementById('oldPw').value;
  const newPw = document.getElementById('newPw').value;
  const confirmPw = document.getElementById('confirmPw').value;
  const errBox = document.getElementById('pwErr');
  const succBox = document.getElementById('pwSuccess');

  errBox.style.display = 'none';
  succBox.style.display = 'none';

  if (newPw !== confirmPw) {
    errBox.textContent = 'New passwords do not match!';
    errBox.style.display = 'block';
    return;
  }

  try {
    const res = await API.post('/auth/change-password', {
      currentPassword: oldPw,
      newPassword: newPw
    });
    succBox.textContent = res.message || 'Password changed successfully!';
    succBox.style.display = 'block';
    setTimeout(() => {
      closePasswordModal();
    }, 1800);
  } catch (err) {
    errBox.textContent = err.message || 'Failed to update password.';
    errBox.style.display = 'block';
  }
}
