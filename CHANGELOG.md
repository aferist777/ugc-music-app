# Changelog

## 0.3.0 - 2026-11-20

### New
- **The chat's tags in Music.** The Music tab now shows every tag of the chat open in Tags, each once, under the chat's name. A new chat's tags appear there as soon as it answers - no need to press them in Tags first. A tag you light in Music lights in Tags too, and the other way round; each chat keeps its own picks, and only the open chat's lit tags go into a press.
- **Genre, Mood and Sound in one row.** Three buttons over the chips: a press shows or hides that group's chips below - one, two or all three. The button shows how many are picked ("Genre · 2").
- **Projects are easier to reach.** A "+" next to Projects in the library makes a new project. The project's name over the timeline opens the list of projects - switch to another or make a new one. A double click on a project in the library renames it.
- **Licenses in the download.** `LICENSE.txt` and `THIRD-PARTY-NOTICES.txt` beside the exe list the software by others inside, with the full texts of their licenses. FFmpeg is under GNU GPL v3; where to get its source is written there.

### Changed
- The price of a press is shown over Generate; the line under the field is gone.
- The Recent row in Music is gone.
- Opening another project empties the field beside Generate.
- The tags you picked in the old shared "From Tags" row are kept: each chat gets the ones that came from it.

## 0.2.1 - 2026-11-13

### Fixed
- Publishing: the release tool no longer stops after sending the code, so every release now comes with its Windows download in one step. Nothing changes in how the app works.

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
