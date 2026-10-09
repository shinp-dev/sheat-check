# Student feedback background artwork

- Work: Caravaggio, **Supper at Emmaus** (1601), National Gallery, London.
- Source/rights: https://commons.wikimedia.org/wiki/File:Supper_at_Emmaus-Caravaggio_(1601).jpg (faithful reproduction of a public-domain painting; consult Commons for full reuse details).
- Verified Wikimedia image (3,840 × 2,731): https://upload.wikimedia.org/wikipedia/commons/thumb/c/c0/Supper_at_Emmaus-Caravaggio_%281601%29.jpg/3840px-Supper_at_Emmaus-Caravaggio_%281601%29.jpg

The student **講義フィードバック** dashboard has an artwork background only while `studentStage === 'dashboard'`. The login and seat-selection stages retain their original appearance. An approximately 91–96% white overlay keeps the UI legible and leaves the existing OK/NG button colors and interactions unchanged.

Artwork selection is centralized in the `--student-feedback-artwork` CSS custom property for possible future theme switching. **There is currently no URL parameter or secret command.**

The image is served externally from Wikimedia Commons rather than committed to the repository. If Commons is inaccessible, CSS will fall back to white; offline/self-hosted delivery would require bundling a separately optimized licensed asset.
