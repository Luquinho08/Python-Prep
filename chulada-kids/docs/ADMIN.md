# Manual breve del panel — Chulada Kids

Ingresá en `/cuenta/ingresar` con tu cuenta del equipo; el panel está en `/admin`. Cada rol ve solo lo que le corresponde:

| Rol | Puede |
|---|---|
| Propietario | Todo, incluidos medios de pago, equipo, configuración, reembolsos y cancelaciones |
| Editor de catálogo | Productos, categorías, temáticas, complementarios, promociones, cupones y contenido |
| Operador de pedidos | Pedidos (estados, notas, pruebas de diseño, CSV) y clientes |

## Productos
1. **Productos → Nuevo producto**: nombre, SKU, precio base (en pesos, por pack o unidad vendida), unidades por pack y categorías. Se crea como **borrador** con una variante "Única".
2. En la ficha del producto: cargá **variantes** (precio propio opcional y stock o cupos), **imágenes** (JPG/PNG/WEBP; la primera es la principal; completá el texto alternativo) y **personalización** (texto, selección con recargos, fecha con anticipación mínima, archivo de referencia).
3. Cambiá el estado a **Publicado**. Si falta algo (imagen, variante, categoría, precio), el sistema explica qué completar.
4. **Vista previa** funciona también con borradores. **Duplicar** crea una copia en borrador con stock 0.
5. Productos **a pedido**: elegí "A pedido (cupos de producción)"; el stock representa cupos, no infinito.
6. Productos **a presupuesto**: marcá la casilla; en la tienda muestran un formulario de consulta en vez de comprar.
7. Un producto con pedidos no se elimina: se **archiva** y se conserva el historial.

## Complementarios ("Completá tu idea")
- En cada producto: **asociar** productos manualmente, ordenarlos y opcionalmente hacerlos **recíprocos**.
- **Complementarios → Matriz**: qué categorías sugieren a cuáles (p. ej., Cajas → Etiquetas). Las sugerencias automáticas además exigen una temática o etiqueta en común.
- Si no hay complementos válidos (publicados y disponibles), el bloque no se muestra.

## Promociones y cupones
- **Promociones**: porcentaje o monto fijo, por productos, categorías o toda la tienda, con inicio y fin en hora de Buenos Aires. No se acumulan salvo que se marquen como acumulables. Revisá la **vista previa de precios**.
- **Cupones**: compra mínima, vencimiento, usos totales y por comprador. Un email de invitado no prueba identidad única.

## Pedidos
- El **estado de pago** lo confirma Mercado Pago; el **estado de preparación** lo manejás vos: Recibido → Pendiente de datos/diseño → Esperando aprobación → En producción → Listo → Enviado/Retirado → Entregado.
- No se puede pasar a **En producción** sin pago aprobado, ni sin diseño aprobado si el producto lo requiere.
- **Aprobación de diseño**: subí la prueba (privada) y el cliente la aprueba o pide cambios desde su enlace.
- **Notas internas** (solo equipo) vs. **mensajes al cliente** (los ve y recibe email).
- **Consultar pago en Mercado Pago** fuerza la conciliación.
- **Incidencias** (pago duplicado, aprobación sin stock, importe distinto): las resuelve el propietario, normalmente con reembolso.
- **Reembolso / Cancelación** (propietario): se ejecutan en Mercado Pago y el estado cambia cuando el proveedor lo confirma.
- **Exportar CSV** respeta los filtros; no incluye notas internas ni datos de pago.

## Contenido y configuración
- **Contenido**: orden de secciones del inicio, franja informativa (solo mensajes reales), banners, preguntas frecuentes y páginas de políticas. Las políticas quedan marcadas como "pendientes" hasta que las redactes.
- **Entregas**: retiro o envíos por código postal (4 dígitos o rangos `1000-1499`) con costo y plazo. El plazo de entrega se suma al de elaboración.
- **Configuración**: datos del comercio, logo real, habilitar la compra y la indexación en buscadores.
- **Equipo**: invitaciones de un solo uso (7 días), cambio de rol y desactivación. Siempre debe quedar un propietario activo.
