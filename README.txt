MONSE MEDIA — UPRIGHT MANILA FOLDER
====================================

WHAT YOU GET
- archive-section.html = replace the existing "Many Mediums. One Vision." section
- archive.css = paste at bottom of your main stylesheet
- js/archive.js = your scrolling animation
- images/photo-01.svg ... photo-10.svg = sample artwork placeholders
- preview.html = a working standalone preview of the effect

HOW TO ADD IT TO YOUR SITE IN VS CODE
1. Open your homepage HTML.
2. Delete ONLY the <section> ... </section> containing "Many Mediums. One Vision."
3. Paste everything from archive-section.html in its place.
4. Paste archive.css at the BOTTOM of your existing CSS file.
5. Put js/archive.js in your website's js/ folder.
6. Put the images/ folder contents in your website's images/ folder.
7. Before your homepage's closing </body>, add:
     <script src="js/archive.js" defer></script>
8. Replace the sample SVG images with your own photographs. For example,
   change images/photo-01.svg to images/photo-01.jpg in the HTML and put
   your photo-01.jpg into the images/ folder.

HOW IT WORKS
- The folder stands UPRIGHT in portrait orientation and says "monses.files".
- On scroll the manila front cover swings open.
- Ten photo cards then slide rightward from the folder one at a time.
- Click a visible photo or the bottom-right CONTINUE button to skip the
  gallery and go straight to normal scrolling below it.
- Keep scrolling normally to pass through the entire gallery without clicking.
- No libraries or plugins needed; responsive and keyboard-friendly.

NOTE: The 10 SVGs are original decorative placeholders, not your actual photographs.
