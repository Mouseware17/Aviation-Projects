# King Air 200 interactive manual

A static site built from the Super King Air 200/B200 Pilot Training Manual and the B200/B200C Pilot Checklist (Revision 3).

Open `index.html` in a browser. It works straight from the file system, with no server or build step.

## What's in it

- **Manual**: all 18 chapters plus General Pilot Information. The full system text is set as readable sections with a navigable table of contents. Figures and tables open in a zoomable viewer, and each chapter's review questions are graded against the manual's answer key.
- **Interactive systems**:
  - **Fuel (Chapter 5)**: a working fuel panel with standby pumps, aux transfer, firewall valves and crossfeed. It reproduces the checklist's fuel system test: FUEL PRESS, NO TRANSFER and FUEL CROSSFEED logic.
  - **Electrical (Chapter 2)**: BAT/GEN switches with the reset sequence, engine starts, GPU, isolation limiters, feeder breakers, avionics master and inverters.
- **Checklist**: Normal, Emergency and Abnormal procedures.
  - Tap-to-check items, with memory items, `+` and `*` markers.
  - Annunciator chips on each procedure.
  - Links to the expanded procedures.
  - Progress is saved in the browser.
- **Walkaround**: the manual's overview photos with numbered markers. Each marker opens its close-up photo, and every item can be checked off.
- **Annunciators**: working warning and caution/advisory panels for BB-1439, 1444 and subsequent. Each lens shows its cause, the related checklist procedures and the chapters that cover it, and there's a drill mode.
- **Search** (`/` or Ctrl+K): searches the manual text, figures, checklist items, annunciators and walkaround items.

## Regenerating the data

The source PDFs are not stored in the repository. With PyMuPDF and Pillow installed:

```sh
python3 tools/extract_manual.py  <Pilot_Training_Manual.pdf> .
python3 tools/extract_checklist.py <Checklist.pdf> .
python3 tools/extract_annunciators.py <Pilot_Training_Manual.pdf> <Checklist.pdf> .
```

These write `data/*.js` and `figures/*.webp`. The simulator behavior lives in `assets/sims.js`; component descriptions there cite the manual pages they come from.

For training and study only. The approved POH/AFM governs flight operations.
