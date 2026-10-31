# Santani Calzado

Versión publicada: https://marianagonzalez4759-bit.github.io/Santani-App/

App web para llevar el negocio de calzado: pedidos, clientes, modelos con fotos y colores,
cotizaciones, finanzas (ingresos, gastos y balance) y pendientes. Está pensada para usarse
con letra grande y botones anchos, desde el teléfono o la computadora.

No necesita servidor ni instalación: son archivos estáticos (HTML y JavaScript, sin dependencias).

## Dónde se guardan los datos

Todo se guarda **en el navegador del equipo donde se usa** (IndexedDB), incluidas las fotos.
No se sube a internet ni a GitHub. Por eso:

- Cada teléfono o computadora tiene sus propios datos. No se sincronizan entre equipos.
- Si se borran los datos del navegador, se pierden. Hay que guardar copias de seguridad.
- En Inicio, al final, está **Copia de seguridad**: "Guardar copia en mi equipo" descarga un
  archivo `.json` (con fotos) y "Restaurar una copia" lo vuelve a cargar, también en otro equipo.

## Publicarla en GitHub Pages

1. Cree un repositorio vacío en GitHub (por ejemplo `santani-calzado`).
2. Desde esta carpeta:
   ```bash
   git init
   git add .
   git commit -m "App Santani Calzado"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/santani-calzado.git
   git push -u origin main
   ```
3. En GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
4. La app queda en `https://TU-USUARIO.github.io/santani-calzado/`.

Nota: en las cuentas gratuitas GitHub Pages solo funciona con repositorios públicos. El
repositorio no contiene datos del negocio (se guardan en cada navegador), solo el código y el logo.

## Usarla como app en el teléfono

- **Android (Chrome):** menú ⋮ → "Instalar app" o "Agregar a pantalla principal".
- **iPhone (Safari):** botón Compartir → "Agregar a pantalla de inicio".

Después de la primera vez abre aunque no haya internet.

## Archivos

| Archivo | Para qué sirve |
| --- | --- |
| `index.html` | La app completa (pantallas, estilos y lógica). |
| `storage.js` | Guarda los datos y las fotos en el navegador y agrega la copia de seguridad. |
| `sw.js`, `manifest.webmanifest` | Permiten instalarla y abrirla sin internet. |
| `assets/` | Logo de Santani e íconos de la app. |

## Probarla en la computadora

Abra una terminal en esta carpeta y ejecute `python3 -m http.server 8000`; luego entre a
`http://localhost:8000`. (Abrir `index.html` con doble clic no guarda datos en algunos navegadores.)
