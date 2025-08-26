# BeweegBaai

BeweegBaai is een interactieve installatie die jouw beweging vertaalt naar muziek en golven.  
Via de ingebouwde webcam van je laptop worden je handen gevolgd en speel je intuïtief piano en viool:

- Links op het scherm = piano  
- Rechts op het scherm = viool  
- Hoogte van je hand = toonhoogte  
- Beweging beïnvloedt kleur, ritme en amplitude van de golf  

Het resultaat is een visuele en auditieve ervaring waarin lichaamstaal muziek wordt.

---

## Demo-video
(Video wordt later toegevoegd)  
[![Demo Video](../media/thumbnail.png)](https://youtu.be/JOUW_VIDEO_LINK)

---

## Repo-structuur

src/
index.html → hoofd-html
style.css → styling (Poppins, fullscreen canvas, overlay, knoppen)
app.js → logica (handtracking, golf-render, audio)
samples/
piano/ → piano-samples (C4, E4, G4, C5)
violin/ → viool-samples (C4, E4, G4, C5)
docs/
README.md → instructable (dit bestand)
media/
thumbnail.png → screenshot of posterframe voor videolink
process/
... → procesdocument (apart toegevoegd)

## Installatie en gebruik

### Vereisten
- Node.js (LTS-versie) + npm  
- Webcam (ingebouwd of extern)  
- Moderne browser (Chrome, Edge)  

### Installatie
Clone de repo en installeer dependencies:
git clone https://github.com/karstenvanvooren/AdemBaai.git
cd AdemBaai
npm install
Starten
bash
Kopiëren
Bewerken
npm start
Open de URL die verschijnt 
Klik “Camera aanzetten” en geef cam-toegang.

Beweeg je handen:
Links = piano
Rechts = viool
Hoogte = hogere of lagere toon
Beweging beïnvloedt golf en intensiteit

### Tips:
D of de debug-knop = debug overlay aan/uit (landmarks en cam-feed)
Klik op de cam-feed om deze weer te sluiten

### Audio-samples
De installatie verwacht standaard deze bestanden:
src/samples/piano/pianoC4.wav
src/samples/piano/pianoE4.wav
src/samples/piano/pianoG4.wav
src/samples/piano/pianoC5.wav
src/samples/violin/violinC4.wav
src/samples/violin/violinE4.wav
src/samples/violin/violinG4.wav
src/samples/violin/violinC5.wav

Extra noten toevoegen? Zet de .wav bestanden in de juiste map en vul de NOTES array in app.js aan.

## Uitleg code

### Handtracking
Gebaseerd op MediaPipe Hands
Per frame worden de coördinaten van beide handen bepaald (x, y)
SelfieMode staat aan zodat je een spiegelbeeld krijgt, net als in een webcam

### Mapping
Links = piano / Rechts = viool (met hysterese om flikkeren te vermijden)
Hoogte (y) bepaalt de gekozen noot (uit de NOTES array)
Bewegingsintensiteit stuurt de amplitude en kleur van de golf

### Audio
Tone.js Sampler speelt .wav-samples
Losse throttle per kant (links/rechts) voorkomt dat noten te snel na elkaar worden afgespeeld
Beide instrumenten lopen door een limiter zodat het volume stabiel blijft

### Visuals
Canvas-golf gecentreerd in beeld
Fase, kleur en amplitude variëren op basis van handpositie en intensiteit
Debug-modus tekent landmarks en palm-points

## Valkuilen en tips
Camera-permissie: zonder toestemming werkt handtracking niet
HTTPS: online heb je HTTPS nodig voor getUserMedia; lokaal werkt http://localhost
Performance: zet debug alleen aan bij testen, dit kost extra rekenkracht
Samples: zorg dat bestandsnamen exact kloppen met de NOTES array

## Credits
MediaPipe Hands (Google) – realtime handtracking
Tone.js – web audio framework
Samples – rechtenvrije bronnen 
violin - https://freesound.org/people/MTG/sounds/247435/,https://freesound.org/people/MTG/sounds/247429/,https://freesound.org/people/MTG/sounds/247819/,https://freesound.org/people/MTG/sounds/355808/
piano - https://freesound.org/people/Teddy_Frost/sounds/334537/, https://freesound.org/people/Teddy_Frost/sounds/334540/, https://freesound.org/people/Teddy_Frost/sounds/334542/, https://freesound.org/people/Teddy_Frost/sounds/334538/