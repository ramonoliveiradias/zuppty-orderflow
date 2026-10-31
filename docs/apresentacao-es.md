# Guion de demostración

Duración sugerida: tres a cinco minutos. Usa tus palabras y muestra el código
cuando te pregunten por una decisión. No hace falta memorizar este texto.

## 1. Contexto

“Este proyecto es una demostración independiente basada en el dominio del
Zuppty GO, que desarrollé. Elegí pedidos y pagos porque permiten explicar
reglas de negocio, concurrencia y reintentos con un ejemplo concreto.”

## 2. Flujo

“Creo un pedido como cliente. El servidor calcula el precio con su catálogo.
Ahora simulo el pago y repito la solicitud: recibo el mismo identificador,
sin registrar otro pago. Cambio al perfil de la tienda y avanzo el pedido.”

Muestra también la cuenta Bruno, que no ve el pedido de Ana.

## 3. Una decisión que puedas explicar

“La clave de idempotencia y el efecto se guardan en la misma transacción.
SQLite permite ejecutar el ejemplo sin infraestructura adicional. Los tests
abren conexiones independientes para comprobar pagos concurrentes.”

Abre `src/orders.ts`, explica `once` y luego muestra el test de concurrencia.

## 4. Límites

“El pago es simulado. Con un proveedor externo necesitaría webhooks,
reconciliación y tratamiento de resultados desconocidos. El selector de
cuentas es para evaluar permisos, no es un login de producción.”

## Preguntas para practicar

- ¿Qué ocurre si el proceso termina antes del commit?
- ¿Por qué una clave nueva tampoco permite un segundo pago?
- ¿Qué diferencia hay entre idempotencia y control de versión?
- ¿Qué cambiarías para varias tiendas y mayor volumen de escritura?
- ¿Por qué no añadiste Redis, un broker o un framework al recorte?

Antes de presentar: recorre el flujo completo y asegúrate de poder explicar
cada respuesta sin depender del texto. Describe esta versión como una
demostración preparada para evaluación; no como un sistema nuevo en producción.
