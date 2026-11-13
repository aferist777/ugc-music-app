# Changelog

## 0.2.0 - 2026-11-13

### New
- **A ready app for Windows.** Download `UGC-Music-Studio-0.2.0-win-x64.zip` below, unpack it anywhere and start `UGC Music Studio.exe` - no Node.js, git or npm needed. Your files live in the `library` folder beside it. Windows may say the app is from an unknown publisher (it is not code-signed): press **More info**, then **Run anyway**.
- **Updates from GitHub.** When a newer version is out, an **Update** chip appears at the top of the window. Press it to see what changed, then **Update now**: the app keeps a copy of its data in `library/backups`, puts the new version in place and restarts. Nothing is forced, and your library is never touched.
- **Donate.** A Donate button next to the app's name leads to DonationAlerts - thank you for using the app! You can also write there what you would like to see in the next updates.
- **The app's own icon** for its window and its exe.

### Fixed
- Dates and times in the app are always in English, whatever the system language.

### Updating from 0.1.0
0.1.0 has no updater yet, so update it once by hand: run `git pull` in the app's folder (then `npm install`), or download the ready app above. From 0.2.0 on, updates come to the app by themselves.

