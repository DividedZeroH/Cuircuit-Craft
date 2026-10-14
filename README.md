# Circuit Craft

Build electronic circuits on a 3D board, watch them run, and do the math, all in the browser.

Circuit Craft simulates the circuit live: capacitors charge, LEDs light up with the current through them, transistors switch, and electrons travel along the traces at a speed that follows the real current. The same circuit can be edited from three connected views.

| View | What it does |
|---|---|
| **Board** | 3D board you can orbit. Place parts, draw traces, drag parts around, flip switches, measure with the multimeter. |
| **Schematic** | The same board drawn with electrical symbols and live node voltages. Fully editable, plus a bill of materials you can copy. |
| **Sheet** | Equations that calculate themselves and plot functions. They read live values (`V_C1`, `I_R1`) and can change the board (`R1 = 4.7k`). |

Available in English, Spanish, Portuguese, German and Japanese, with light and dark themes.

## Parts

Power supply (DC, sine or square wave), resistor, potentiometer, capacitor, inductor, diode, LED, switch, N- and P-channel MOSFET, and a processor that acts as a load. The examples menu includes an RC filter, a CMOS inverter and a NAND gate.

## Quick start

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check and build into dist/
```

Requires Node.js 18 or newer.

## How to use it

1. Pick a part in the left bar (or press its key) and tap the board to place it. `R` rotates it.
2. Pick **Trace** (`T`) and tap points to connect terminals. Double-tap or press Enter to finish.
3. The simulation starts right away. Open **Calculations** (Σ) to see every formula with numbers, or tap a part to edit its value.
4. Use the **multimeter** (`M`): the first tap is the red probe, the second the black one. The oscilloscope shows the voltage over time.
5. In **Sheet**, write `R2 = 2.2k` to change the board, or `f(t) = 5 * (1 - exp(-t / tau))` to plot a curve.

| Key | Action | Key | Action |
|---|---|---|---|
| V | View and move | T | Trace |
| M | Multimeter | X | Erase |
| 1–9 | Parts | N / P | MOSFET N / P |
| R | Rotate | Ctrl Z | Undo |

## Deploying

The repository includes `vercel.json`. Import the repository in Vercel and deploy: it runs `npm run build` and serves `dist/`. Any static host works the same way.

## Project structure

```
src/
  domain/          circuit model, simulator, expression language (no DOM, no three.js)
  application/     shared store, editor, multimeter, sheet ↔ circuit sync
  infrastructure/  storage, clipboard, translations
  presentation/    board (three.js), schematic (SVG), sheet, panels
  main.ts          wires everything together
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the layer rules, branch names and commit style.

## License

[MIT](LICENSE): free to use, copy, modify and distribute, including for commercial use.

---

### En español

Circuit Craft es un simulador de circuitos en 3D que corre en el navegador. Armás la placa, la simulación calcula voltajes y corrientes en vivo, y podés editar el mismo circuito desde la placa, el esquema o la pizarra de ecuaciones. Para correrlo: `npm install` y `npm run dev`. Se publica en Vercel importando el repositorio.
