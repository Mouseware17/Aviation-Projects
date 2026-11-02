# Aviation-Projects
## King Air 350 Systems — offline use

`king-air-350/offline/index.html` is a single self-contained copy of the study site (fonts and figures embedded), so it works with no internet connection:

- **Desktop / Android:** download that one file and open it in a browser.
- **iPhone / iPad (installable app):** host the `king-air-350/offline/` folder over HTTPS (for example GitHub Pages), open it once in Safari, then Share → Add to Home Screen. The service worker caches it for offline use.

After editing `king-air-350/index.html`, rebuild the offline copy with `python3 king-air-350/tools/build_offline.py`.
