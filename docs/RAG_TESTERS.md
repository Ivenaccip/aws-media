# /automatiza con testers — régimen TEMPORAL (RAG·29)

Decisión del dueño, 5-oct-2026. Dura **una a dos semanas** (hasta ~19-oct), mientras se
recupera información de los testers. Al terminar, se invierte: /automatiza pasa de abonar
a cobrar (el número se decide con los datos de la prueba).

## Cómo funciona hoy

- `/automatiza` vive **pública en dev**: `https://illyp2jbff.execute-api.us-east-1.amazonaws.com/automatiza`.
- El dueño manda testers. Cada tester pide su flujo y **deja su correo**: el mismo con el que
  tiene cuenta en la plataforma de producción (main).
- **No se cobra.** Al revés: cada **uso** abona **20 créditos** en su cuenta de producción (6-oct: subió de 10 a 20; el costo medido de Claude por armado ronda los 9 créditos).
  - Cuenta como uso una corrida terminada (`listo` o `no_salio`) con correo. Las
    rechazadas por el filtro y las que siguen en curso no cuentan.
  - Vale el último correo que se dejó en esa corrida.
  - Máximo **5 usos abonados al día por cuenta** (hora de México).
  - Los dos números viven en `tools/tarifas.json` §`rag`.
- El abono **no es instantáneo**: lo hace el dueño con `tools/abonos_testers.py` (primero
  el ensayo, luego `--abonar` y teclear PROD). Correrlo dos veces no abona doble
  (referencia `rag-tester:<id público>` en `monedero_movimientos`).
- Si el correo no tiene cuenta en producción, ese uso no se abona y sale contado en el ensayo.

## Por qué no lo abona el servidor de dev directamente

Dev no tiene permiso sobre la base de producción, y no debe tenerlo: un error en dev
movería créditos reales. La herramienta solo **lee** dev y escribe en producción con las
mismas protecciones que `tools/creditos.py`: cruza el clúster contra CloudFormation y pide
teclear PROD.

## Lo que se está midiendo

- Cuántos flujos salen (`listo`) contra cuántos no (`no_salio`), y cuántos intentos del
  validador hacen falta: `tools/automatiza.py corridas --dias N`.
- Costo real por corrida (RAG·24). Faltan los precios de lectura de caché y de S3 Vectors
  en `tools/pricing.json`.
- Trazas por etapa en Langfuse (proyecto nuevo, tags `automatiza` y `publico`).
- Reportes de los testers.

## Riesgos aceptados mientras dure

- Cualquiera con el enlace de dev puede escribir el correo de otra persona: los créditos le
  llegarían a esa otra cuenta. Lo limitan el tope diario de corridas de dev (20), el tope
  por conexión y el máximo de 5 abonos al día por cuenta.
- El aviso de privacidad publicado no menciona que el correo se usa para buscar la cuenta
  y abonar. Los testers lo saben porque los invita el dueño. Hay que corregirlo si esto
  sigue más allá de la prueba.

## Al terminar la prueba (checklist)

1. Dejar de correr `tools/abonos_testers.py`. Hacer una última pasada para no dejar usos
   sin abonar.
2. Pasar `/automatiza` a cobrar: `abono_tester_por_uso` deja de usarse y se agrega un
   `cobro_por_uso` en `tools/tarifas.json` §`rag`. El número se decide con los datos de la prueba: el abono de 20 era incentivo, no la tarifa.
   Va junto con el cambio de RAG·29: términos aceptados al entrar a la plataforma y
   `/automatiza` dentro del Estudio, con la cuenta.
3. Borrar `tools/abonos_testers.py`, sus tests y este documento, o dejarlos marcados como
   históricos.
4. Revisar los pendientes de RAG·30 antes del dev→main.
