# Покрытие пилота HELIOS — пункт 19.2 ТЗ 4.0

Это карта требований к **существующим GitHub Issues**, не отдельный трекер. Статусы, PR и доказательства ведутся в связанных issues. Наличие карточки означает запланированный объём, а не готовую функцию. Основание: сводное ТЗ 4.0, §§5.3–5.4, 10–11, 13.6, 14, 18, 19.2 и 20.1. Ссылка вида 19.2.1 означает первый пункт списка 19.2.

R01–R27 сохраняют границу подключения ядра. R28–R39 закрывают обязательный функциональный остаток; R40–R49 — безопасность и эксплуатацию, R50 — сквозную приёмку. R51 добавляет автоматические проверки текущих механизмов. Это уточнение полноты плана, без изменения цены или договора.

| Пункт ТЗ | Результат | Задачи GitHub | Что важно не потерять |
| --- | --- | --- | --- |
| 19.2.1 | Сотрудник, квалификации, допуск | [R01](https://github.com/glebvin/helios/issues/1), [R02](https://github.com/glebvin/helios/issues/2), [R03](https://github.com/glebvin/helios/issues/3), [R04](https://github.com/glebvin/helios/issues/4), [R05](https://github.com/glebvin/helios/issues/5), [R06](https://github.com/glebvin/helios/issues/6), [R29](https://github.com/glebvin/helios/issues/35) | Допуск R06 не закрывается карточкой/квалификацией; общие типы чек-листов — R29. |
| 19.2.2 | Объект и бригада | [R07](https://github.com/glebvin/helios/issues/7), [R28](https://github.com/glebvin/helios/issues/34) | R07 не заменяет обязательный состав и историю бригады R28. |
| 19.2.3 | Дневное задание и готовность фронта | [R08](https://github.com/glebvin/helios/issues/8), [R09](https://github.com/glebvin/helios/issues/9), [R10](https://github.com/glebvin/helios/issues/10), [R11](https://github.com/glebvin/helios/issues/11), [R12](https://github.com/glebvin/helios/issues/12), [R29](https://github.com/glebvin/helios/issues/35), [R34](https://github.com/glebvin/helios/issues/40), [R37](https://github.com/glebvin/helios/issues/43) | Публикация с требованиями материалов/предшественника не считается готовой до R34/R37. |
| 19.2.4 | Смена, простои, выполненный объём | [R13](https://github.com/glebvin/helios/issues/13), [R14](https://github.com/glebvin/helios/issues/14), [R15](https://github.com/glebvin/helios/issues/15), [R16](https://github.com/glebvin/helios/issues/16), [R17](https://github.com/glebvin/helios/issues/17), [R18](https://github.com/glebvin/helios/issues/18), [R19](https://github.com/glebvin/helios/issues/19), [R20](https://github.com/glebvin/helios/issues/20), [R23](https://github.com/glebvin/helios/issues/23), [R24](https://github.com/glebvin/helios/issues/24), [R25](https://github.com/glebvin/helios/issues/25), [R26](https://github.com/glebvin/helios/issues/26) | Сообщённое ≠ принятое; присутствие ≠ часы задания. ПТО/СК — R30/R31. |
| 19.2.5 | Самоконтроль, наш ПТО, СК заказчика, замечания | [R22](https://github.com/glebvin/helios/issues/22), [R27](https://github.com/glebvin/helios/issues/27), [R29](https://github.com/glebvin/helios/issues/35), [R30](https://github.com/glebvin/helios/issues/36), [R31](https://github.com/glebvin/helios/issues/37) | R22 — чтение, а не приёмка. Нужны все уровни, частичные объёмы и повторы. |
| 19.2.6 | Мои дела, 14 маршрутов, полномочия | [R21](https://github.com/glebvin/helios/issues/21), [R27](https://github.com/glebvin/helios/issues/27), [R32](https://github.com/glebvin/helios/issues/38), [R33](https://github.com/glebvin/helios/issues/39) | R21 показывает ядро, не полный маршрут. Типы документов подключаются в R29–R38 и проверяются в R50. |
| 19.2.7 | Удобство по 13.6 до объекта | [R39](https://github.com/glebvin/helios/issues/45) | Пять представителей участвующих ролей, ≥90% успеха и нормативы времени. Автотест/эмуляция не заменяют людей. |
| 19.2.8 | Материалы и входной контроль | [R29](https://github.com/glebvin/helios/issues/35), [R32](https://github.com/glebvin/helios/issues/38), [R34](https://github.com/glebvin/helios/issues/40) | Партии, документы и блокировки; без склада/закупочной ERP. |
| 19.2.9 | Реестр ИД, АОСР и точки остановки | [R33](https://github.com/glebvin/helios/issues/39), [R35](https://github.com/glebvin/helios/issues/41), [R36](https://github.com/glebvin/helios/issues/42), [R37](https://github.com/glebvin/helios/issues/43) | Обязательный комплект, сканы, один согласованный АОСР/PDF, блокировки. Без XML и криптоподписи. |
| 19.2.10 | Утренняя сводка | [R21](https://github.com/glebvin/helios/issues/21), [R38](https://github.com/glebvin/helios/issues/44) | Подтверждённые и предварительные данные, качество и ИД. Не только сводка часов. |

## Маршруты пилота — 14 строк, не весь документооборот компании

Общий механизм — [R32](https://github.com/glebvin/helios/issues/38), [R33](https://github.com/glebvin/helios/issues/39). Матрица компании определяет роли/буквы; backend не выдаёт всем полномочия director/pto.

| Строка матрицы §5.3 | Документ | Подключение |
| --- | --- | --- |
| 12.1 | Дневное задание | [R12](https://github.com/glebvin/helios/issues/12), [R32](https://github.com/glebvin/helios/issues/38) |
| 12.2 | Готовность фронта | [R11](https://github.com/glebvin/helios/issues/11), [R29](https://github.com/glebvin/helios/issues/35), [R32](https://github.com/glebvin/helios/issues/38) |
| 12.11 | Допуск сотрудника | [R06](https://github.com/glebvin/helios/issues/6), [R29](https://github.com/glebvin/helios/issues/35), [R32](https://github.com/glebvin/helios/issues/38) |
| 12.3 | Сдача нашему СК | [R30](https://github.com/glebvin/helios/issues/36), [R32](https://github.com/glebvin/helios/issues/38) |
| 12.4 | Сдача СК заказчика | [R31](https://github.com/glebvin/helios/issues/37), [R32](https://github.com/glebvin/helios/issues/38) |
| 12.5 | Устранение замечаний | [R31](https://github.com/glebvin/helios/issues/37), [R32](https://github.com/glebvin/helios/issues/38) |
| 2.2 | Входной контроль | [R34](https://github.com/glebvin/helios/issues/40), [R32](https://github.com/glebvin/helios/issues/38) |
| 3.1 | АОСР | [R36](https://github.com/glebvin/helios/issues/42), [R33](https://github.com/glebvin/helios/issues/39), [R32](https://github.com/glebvin/helios/issues/38) |
| 3.8 | Реестр ИД | [R35](https://github.com/glebvin/helios/issues/41), [R32](https://github.com/glebvin/helios/issues/38) |
| 12.12 | Закрытие дня | [R38](https://github.com/glebvin/helios/issues/44), [R32](https://github.com/glebvin/helios/issues/38) |
| 8.3 | Табель | [R19](https://github.com/glebvin/helios/issues/19), [R20](https://github.com/glebvin/helios/issues/20), [R32](https://github.com/glebvin/helios/issues/38) |
| 12.10 | Не готово к КС-2 | [R37](https://github.com/glebvin/helios/issues/43), [R38](https://github.com/glebvin/helios/issues/44), [R32](https://github.com/glebvin/helios/issues/38) |
| 12.6 | Шаблоны сдачи | [R29](https://github.com/glebvin/helios/issues/35), [R32](https://github.com/glebvin/helios/issues/38) |
| 12.7 | Перечень ИД объекта | [R35](https://github.com/glebvin/helios/issues/41), [R32](https://github.com/glebvin/helios/issues/38) |

Строки 3.13 (приёмка ИД субподрядчика), 12.8 (акт простоя), 12.9 (нормы) в исходной матрице относятся к следующему этапу. Базовая фиксация простоя остаётся в пилоте; полный отдельный акт не добавляется скрытно. Нормативную эффективность не включаем до утверждения норм.

## Барьер до реальных работников и данных

- MFA, сессии/вход, пароли и изоляция ПД/файлов: [R40](https://github.com/glebvin/helios/issues/46), [R41](https://github.com/glebvin/helios/issues/47), [R42](https://github.com/glebvin/helios/issues/48), [R43](https://github.com/glebvin/helios/issues/49).
- Runtime-зависимости и HTTPS-политики: [R44](https://github.com/glebvin/helios/issues/50), [R45](https://github.com/glebvin/helios/issues/51).
- Резервы с восстановлением, мониторинг и нагрузка: [R46](https://github.com/glebvin/helios/issues/52), [R47](https://github.com/glebvin/helios/issues/53), [R48](https://github.com/glebvin/helios/issues/54).
- Выпуск, инструкции и эксплуатационный комплект: [R49](https://github.com/glebvin/helios/issues/55).
- Полная приёмка, включая запреты §18.4: [R50](https://github.com/glebvin/helios/issues/56).

Юридические основания, языки, нагрузочный профиль, RPO/RTO и адресаты сигналов согласуются с ответственными заказчика; техническая реализация не заменяет эти решения. Тестовые учётки допустимы только на синтетических данных.

## Что CI доказывает и чего не доказывает

[R51](https://github.com/glebvin/helios/issues/57) проверяет текущие R01–R03 и существующую offline-библиотеку: реальный браузер, NestJS и одноразовый PostgreSQL. Проверки не подключают будущие экраны автоматически и не закрывают [R23](https://github.com/glebvin/helios/issues/23), [R24](https://github.com/glebvin/helios/issues/24), [R25](https://github.com/glebvin/helios/issues/25), [R26](https://github.com/glebvin/helios/issues/26), [R39](https://github.com/glebvin/helios/issues/45), [R50](https://github.com/glebvin/helios/issues/56).

## Не входит в пилот

ИИ-помощник, BI, ставки/себестоимость, интеграции с 1С и Битрикс24 (вместо них Excel), XML ИД. Аппаратное позиционирование/камеры также не добавляются этой картой. Цены, сроки и дополнительные языки не меняются автоматически.

[Вернуться к roadmap](../ROADMAP.md)
