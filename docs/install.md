# Installing Naushen Mail

Naushen Mail runs on macOS, Windows and Linux. Only **Gmail** accounts are supported today (Outlook is coming). Want to build it
yourself? See [building.md](building.md).

## 1. Download

Open the [latest release](https://github.com/curiousanthony/naushen-mail/releases/latest) and download the file for your system.
Names contain the version number (`<version>`):

| System | File |
|---|---|
| macOS, Apple Silicon (M1 or later) | `Naushen-Mail-<version>-mac-arm64.dmg` |
| macOS, Intel | `Naushen-Mail-<version>-mac-x64.dmg` |
| Windows | `Naushen-Mail-<version>-<arch>-Setup.exe` (`x64` for most PCs, `arm64` for ARM PCs) |
| Linux | `.AppImage` (any distro) or `.deb` (Debian, Ubuntu) |

Not sure which Mac you have? Apple menu, **About This Mac**: "Apple M..." means Apple Silicon, "Intel" means Intel.

## 2. Install and first launch

The builds are currently **not code-signed or notarised**, so macOS and Windows show a warning the first time. This is
expected; it goes away once signed builds are published.

### macOS
1. Open the `.dmg` and drag **Naushen Mail** to **Applications**.
2. In Applications, **right-click** Naushen Mail, choose **Open**, then **Open** in the dialog. You only do this once.
3. If macOS only offers "Done" (recent versions): open **System Settings, Privacy & Security**, scroll down to the message
   about Naushen Mail and click **Open Anyway**.
4. If macOS says the app is "damaged", remove the download flag in Terminal:
   ```bash
   xattr -dr com.apple.quarantine "/Applications/Naushen Mail.app"
   ```
5. The first time it stores a sign-in, macOS may ask to use "Naushen Mail Safe Storage" in your Keychain. Enter your login
   password and choose **Always Allow**.

### Windows
1. Run the `Setup.exe`.
2. On the blue **Windows protected your PC** (SmartScreen) screen click **More info**, then **Run anyway**.
3. Follow the installer. Launch Naushen Mail from the Start menu.

### Linux
- **AppImage:** `chmod +x Naushen-Mail-*.AppImage && ./Naushen-Mail-*.AppImage`. On some distros you also need FUSE 2
  (`libfuse2`) or to run with `--appimage-extract-and-run`.
- **.deb:** `sudo apt install ./naushen-mail_*.deb`.
- Sign-in tokens are encrypted through your desktop's secret service (GNOME Keyring, KWallet). If none is running, Electron
  cannot provide real encryption; keep your disk encrypted and install a keyring for proper protection.

## 3. Add your account

Open **Settings, Accounts, Add account** and sign in with Google in your browser. Choose **Demo** to try the app offline with
sample mail.

## 4. Make it your default mail app (`mailto:` links)

- **macOS:** the app registers the `mailto:` scheme. Open Apple Mail, Settings, General, **Default email reader**, and pick
  Naushen Mail (Mail must have been opened once).
- **Windows:** Settings, Apps, **Default apps**, search for "mailto" and choose Naushen Mail.
- **Linux:** `xdg-settings set default-url-scheme-handler mailto naushen-mail.desktop` (desktop file name may vary by package).

Clicking a `mailto:` link then opens a composer prefilled with the recipient, subject and body.

## 5. Where your data lives

| OS | Folder |
|---|---|
| macOS | `~/Library/Application Support/Naushen Mail` |
| Windows | `%APPDATA%\Naushen Mail` |
| Linux | `~/.config/Naushen Mail` |

It holds the local mail cache (`mailroom.db`), settings and encrypted tokens. Nothing else is stored elsewhere apart from
the OS secure-store key used for encryption.

## 6. Updating

Download the newer installer from the releases page and install over the old one; your data is kept. (There is no
auto-updater yet.)

## 7. Uninstall

1. Remove the app: macOS, drag it to the Trash; Windows, Settings, Apps, Uninstall; Linux, delete the AppImage or
   `sudo apt remove naushen-mail`.
2. Optionally delete the data folder from the table above (this removes the cache and stored tokens).
3. Revoke access at <https://myaccount.google.com/permissions> (see [PRIVACY.md](PRIVACY.md)).

## Troubleshooting

| Symptom | Fix |
|---|---|
| macOS: "can't be opened" / "damaged" | See macOS steps 2 to 4 above |
| macOS: wrong architecture | Use `arm64` on Apple Silicon and `x64` on Intel (`uname -m`) |
| macOS: Keychain asks repeatedly | Choose **Always Allow**. Ad-hoc builds change identity on each update, so this can reappear |
| macOS: quits immediately on Apple Silicon | The signature was lost by the copy tool; re-sign: `codesign --force --deep --sign - "/Applications/Naushen Mail.app"` |
| Google says "hasn't verified this app" | Expected while the app has not passed Google's OAuth verification: click **Advanced**, then **Go to Naushen Mail**. See [maintainers.md](maintainers.md#google-oauth-verification) for why |
| Blank window or crash on start | Run the executable from a terminal to see errors. Then try a clean profile by moving the data folder aside |
| Start over | Quit the app and delete the data folder |
