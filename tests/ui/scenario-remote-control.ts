import type { Page } from 'playwright';

/**
 * UI scenario: reconnection banner, clipboard controls and device profiles.
 * The main process is mocked here; real-phone behaviour is covered by the hardware checks in the Phase 7 report.
 */
export async function runRemoteControlScenario(page: Page, recordTest: (name: string, ok: boolean, detail?: string) => void): Promise<void> {
  console.log('\nScenario 16: Reconnection banner, Clipboard and Device Profiles');
  await page.addInitScript(() => {
    const w = window as any;
    const dev = { serial: 'PHONE1', state: 'device', model: 'Redmi', product: 'p', device: 'd', transportType: 'usb', connectionType: 'usb', rawState: 'device', guidance: '' };
    const api = w.androscrnApi;
    api.getDevices = async () => [dev];
    w.__profiles = [];
    w.__clip = { sends: 0, result: { success: true, message: 'Sent your PC clipboard to the phone and pasted it.' } };
    w.__recovery = { resumes: 0, cancels: 0 };
    w.__started = [];
    api.getSettings = async () => ({ qualityPreset: 'balanced', inputMode: 'auto', clipboardSync: false });
    api.updateSettings = async (patch: any) => { w.__lastSettingsPatch = patch; return { success: true }; };
    api.listProfiles = async () => w.__profiles.map((x: any) => ({ ...x }));
    api.saveProfile = async (pr: any) => {
      if (!pr.name.trim()) return { success: false, message: 'Give the profile a name (1-48 characters).' };
      if (w.__profiles.some((x: any) => x.name.toLowerCase() === pr.name.trim().toLowerCase() && x.id !== pr.id)) {
        return { success: false, message: `A profile named "${pr.name.trim()}" already exists.` };
      }
      const id = pr.id || 'p_' + String(w.__profiles.length + 1).padStart(16, '0');
      const profile = { id, name: pr.name.trim(), deviceSerial: pr.deviceSerial, deviceLabel: pr.deviceLabel, settings: pr.settings, createdAt: 1, updatedAt: 2 };
      w.__profiles = pr.id ? w.__profiles.map((x: any) => (x.id === pr.id ? profile : x)) : [...w.__profiles, profile];
      return { success: true, profile };
    };
    api.deleteProfile = async (id: string) => { w.__profiles = w.__profiles.filter((x: any) => x.id !== id); return { success: true }; };
    api.pasteClipboardToDevice = async (serial: string) => { w.__clip.sends++; w.__clip.serial = serial; return w.__clip.result; };
    api.resumeSession = async () => { w.__recovery.resumes++; return { success: true, message: 'Session resumed.' }; };
    api.cancelSessionRecovery = async () => { w.__recovery.cancels++; return {}; };
    api.onSessionRecoveryChanged = (cb: (d: any) => void) => { w.__recoveryCb = cb; return () => {}; };
    // Mirroring status reported by the (mock) main process follows start/stop, as the real one does.
    w.__running = false;
    api.getMirrorStatus = async () => ({ running: w.__running, targetSerial: w.__running ? 'PHONE1' : undefined });
    api.startMirroring = async (o: any) => { w.__started.push(o); w.__running = true; return { success: true, pid: 1 }; };
    api.stopMirroring = async () => { w.__running = false; return true; };
  });
  await page.reload();
  await page.waitForSelector('#global-device-select');
  await page.waitForTimeout(500);

  const text = async (sel: string) => (await page.textContent(sel)) ?? '';
  const recover = (state: any) => page.evaluate((st) => (window as any).__recoveryCb(st), state);

  // --- Reconnection banner ---
  await recover({ state: 'reconnecting', serial: 'PHONE1', message: 'Reconnecting… Reconnect the cable or keep the phone nearby.', canResume: false, recoveryId: 1 });
  await page.waitForSelector('[data-testid="session-recovery"]');
  recordTest('Reconnecting state shows "Device disconnected" with a Cancel action',
    /Device disconnected/.test(await text('[data-testid="session-recovery"]')) && (await page.locator('[data-testid="session-recovery"] button:has-text("Cancel")').count()) === 1);
  await page.click('[data-testid="session-recovery"] button:has-text("Cancel")');
  recordTest('Cancel on the banner calls the main process', (await page.evaluate(() => (window as any).__recovery.cancels)) === 1);
  await recover({ state: 'failed', serial: 'PHONE1', message: "Couldn't reconnect: the phone did not come back.", canResume: true, recoveryId: 1 });
  await page.waitForTimeout(150);
  recordTest("Failed recovery says Couldn't reconnect and offers Resume session",
    /Couldn't reconnect/.test(await text('[data-testid="session-recovery"]')) && (await page.locator('[data-testid="session-recovery"] button:has-text("Resume session")').count()) === 1);
  await page.click('[data-testid="session-recovery"] button:has-text("Resume session")');
  recordTest('Resume session calls the main process once', (await page.evaluate(() => (window as any).__recovery.resumes)) === 1);
  await recover({ state: 'restored', serial: 'PHONE1', message: 'Connection restored.', canResume: false, recoveryId: 2 });
  await page.waitForTimeout(150);
  recordTest('Restored state shows "Connection restored" without a retry indicator',
    /Connection restored/.test(await text('[data-testid="session-recovery"]')) && (await page.locator('[data-testid="session-recovery"] .animate-spin').count()) === 0);
  await recover({ state: 'idle', serial: null, message: '', canResume: false, recoveryId: 3 });
  await page.waitForTimeout(150);
  recordTest('Idle recovery state removes the banner', (await page.locator('[data-testid="session-recovery"]').count()) === 0);

  // --- Clipboard ---
  await page.click('#tab-mirror');
  await page.waitForSelector('[data-testid="clipboard-controls"]');
  recordTest('Clipboard sync is off by default (opt-in)', !(await page.isChecked('#toggle-clipboard-sync')));
  recordTest('Send clipboard is disabled until mirroring runs', await page.locator('[data-testid="clipboard-controls"] button').isDisabled());
  await page.click('button[aria-label="Start screen mirroring session"]');
  await page.waitForTimeout(400);
  recordTest('Mirroring starts with scrcpy automatic clipboard sync turned off by default',
    (await page.evaluate(() => (window as any).__started[0]))?.noClipboardAutosync === true);
  await page.click('#toggle-clipboard-sync');
  await page.waitForTimeout(300);
  recordTest('Turning clipboard sync on is saved to settings', (await page.evaluate(() => (window as any).__lastSettingsPatch))?.clipboardSync === true);
  recordTest('Send clipboard is enabled while mirroring', await page.locator('[data-testid="clipboard-controls"] button').isEnabled());
  await page.click('[data-testid="clipboard-controls"] button');
  await page.waitForTimeout(300);
  recordTest('Send clipboard targets the selected phone and shows the result',
    (await page.evaluate(() => (window as any).__clip.serial)) === 'PHONE1' && /pasted it/.test(await text('[data-testid="clipboard-controls"]')));
  await page.evaluate(() => { (window as any).__clip.result = { success: false, message: 'Your PC clipboard has no text to send.' }; });
  await page.click('[data-testid="clipboard-controls"] button');
  await page.waitForTimeout(300);
  recordTest('Empty clipboard error is shown to the user', /no text to send/.test(await text('[data-testid="clipboard-controls"]')));

  // --- Profiles ---
  await page.click('button[aria-label="Stop screen mirroring session"]');
  await page.waitForTimeout(300);
  recordTest('Empty state explains how to create a profile', /No saved profiles/.test(await text('[data-testid="profile-bar"]')));
  await page.locator('div[role="radio"]:has-text("Ultra Quality")').click();
  await page.click('[data-testid="profile-bar"] button:has-text("Save as profile")');
  await page.fill('#profile-name', 'Gaming');
  await page.click('[role="dialog"] button:has-text("Save")');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => (window as any).__profiles[0]);
  recordTest('Saving a profile stores the current supported settings',
    saved?.name === 'Gaming' && saved.settings.qualityPreset === 'ultra' && saved.settings.clipboardSync === true && !('extraArgs' in saved.settings));
  recordTest('The new profile is listed and selected', (await page.$eval('#profile-select', (el: any) => el.selectedOptions[0].textContent)) === 'Gaming');
  await page.click('[data-testid="profile-bar"] button:has-text("Save as profile")');
  await page.fill('#profile-name', 'gaming');
  await page.click('[role="dialog"] button:has-text("Save")');
  await page.waitForTimeout(200);
  recordTest('Duplicate profile name is rejected with a clear message', /already exists/.test(await text('[role="alert"]')));
  await page.click('[role="dialog"] button:has-text("Cancel")');

  await page.locator('div[role="radio"]:has-text("Battery Saver")').click();
  await page.selectOption('#profile-select', '');
  await page.selectOption('#profile-select', saved.id);
  await page.waitForTimeout(300);
  recordTest('Applying a profile restores its settings', (await page.locator('div[role="radio"]:has-text("Ultra Quality")').getAttribute('aria-checked')) === 'true');

  // Applying during a session needs an explicit, cancellable restart
  await page.locator('div[role="radio"]:has-text("Battery Saver")').click();
  await page.click('button[aria-label="Start screen mirroring session"]');
  await page.waitForTimeout(400);
  const startsBefore = await page.evaluate(() => (window as any).__started.length);
  await page.selectOption('#profile-select', '');
  await page.selectOption('#profile-select', saved.id);
  await page.waitForSelector('#profile-confirm-title');
  const confirmText = await text('[role="dialog"]');
  recordTest('Applying during mirroring asks first and lists what will change', /restart/i.test(confirmText) && /Quality/.test(confirmText));
  await page.click('[role="dialog"] button:has-text("Cancel")');
  await page.waitForTimeout(200);
  recordTest('Cancelling the confirmation leaves the session and settings untouched',
    (await page.evaluate(() => (window as any).__started.length)) === startsBefore &&
      (await page.locator('div[role="radio"]:has-text("Battery Saver")').getAttribute('aria-checked')) === 'true');
  await page.selectOption('#profile-select', '');
  await page.selectOption('#profile-select', saved.id);
  await page.waitForSelector('#profile-confirm-title');
  await page.click('[role="dialog"] button:has-text("Apply and restart")');
  await page.waitForTimeout(1200);
  const restarted = await page.evaluate(() => { const a = (window as any).__started; return a[a.length - 1]; });
  recordTest('Confirmed apply restarts mirroring with the profile settings',
    (await page.evaluate(() => (window as any).__started.length)) === startsBefore + 1 && restarted?.preset === 'ultra' && restarted?.noClipboardAutosync === false);
  await page.click('button[aria-label="Stop screen mirroring session"]');
  await page.waitForTimeout(300);

  // A profile made for another phone needs confirmation
  await page.evaluate(() => {
    (window as any).__profiles.push({ id: 'p_0000000000000099', name: 'Other phone', deviceSerial: 'OTHER', deviceLabel: 'Pixel', settings: { qualityPreset: 'balanced' }, createdAt: 1, updatedAt: 1 });
  });
  await page.click('#tab-about');
  await page.click('#tab-mirror');
  await page.waitForTimeout(400);
  await page.selectOption('#profile-select', 'p_0000000000000099');
  await page.waitForSelector('#profile-confirm-title');
  const otherText = await text('[role="dialog"]');
  recordTest('A profile for another phone shows a warning and lists unspecified settings as untouched', /made for Pixel/.test(otherText) && /left as they are/.test(otherText));
  await page.click('[role="dialog"] button:has-text("Cancel")');

  // Delete with confirmation
  await page.selectOption('#profile-select', saved.id);
  await page.waitForTimeout(200);
  if (await page.locator('#profile-confirm-title').count()) await page.click('[role="dialog"] button:has-text("Apply")');
  await page.click('[data-testid="profile-bar"] button:has-text("Delete")');
  await page.waitForSelector('#profile-delete-title');
  await page.click('[role="alertdialog"] button:has-text("Cancel")');
  recordTest('Cancelling delete keeps the profile', await page.evaluate((id) => (window as any).__profiles.some((x: any) => x.id === id), saved.id));
  await page.click('[data-testid="profile-bar"] button:has-text("Delete")');
  await page.click('[role="alertdialog"] button:has-text("Delete")');
  await page.waitForTimeout(300);
  recordTest('Confirmed delete removes the profile', !(await page.evaluate((id) => (window as any).__profiles.some((x: any) => x.id === id), saved.id)));
}
