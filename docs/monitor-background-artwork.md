# Monitor background artwork

The teacher's **みんなの様子** monitor uses an atmospheric background of
Caravaggio's *The Calling of Saint Matthew* (*聖マタイの召命*, c. 1599–1600).

- Source image: https://commons.wikimedia.org/wiki/File:The_Calling_of_Saint_Matthew-Caravaggo_(1599-1600).jpg
- Direct image: https://upload.wikimedia.org/wikipedia/commons/thumb/4/48/The_Calling_of_Saint_Matthew-Caravaggo_%281599-1600%29.jpg/3840px-The_Calling_of_Saint_Matthew-Caravaggo_%281599-1600%29.jpg
- License: public domain (Wikimedia Commons' PD-Art designation; check the file page for details).
- Display resolution: up to **3,840 pixels** wide; delivered as a Wikimedia thumbnail rather than the 9,770-pixel, 10MB+ original.
- Use: CSS background *only within the teacher monitoring classroom dashboard grid* (controls, seat map and right rail), not on the full-height page shell. The 85–88% light overlay is retained, the seat panel stays translucent, and controls remain unchanged. The canvas below the classroom stays plain `#f8fafc`, including on tall mobile viewports.

The image is loaded from Wikimedia Commons when the browser displays the monitor (it is **not checked into this repository**). If self-hosting or offline use is needed, download a suitably optimized licensed copy into `packages/frontend/public/`, update the CSS reference and keep this attribution.
