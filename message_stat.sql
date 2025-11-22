DROP TABLE IF EXISTS `message_stat`;
CREATE TABLE `message_stat` (
  `id` bigint unsigned NOT NULL,
  `last_consumer_hash` int unsigned NOT NULL,
  PRIMARY KEY (`id`,`last_consumer_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE message_stat
PARTITION BY HASH(last_consumer_hash) 
PARTITIONS 64;

-- Trigger Insert
DELIMITER $$

CREATE TRIGGER trg_message_after_insert
AFTER INSERT ON message
FOR EACH ROW
BEGIN
    INSERT INTO message_stat (id, last_consumer_hash)
    VALUES (
        NEW.id,
        IF(NEW.last_consumer IS NULL OR NEW.last_consumer = '', 0, CRC32(NEW.last_consumer))
    )
    ON DUPLICATE KEY UPDATE
        last_consumer_hash = IF(NEW.last_consumer IS NULL OR NEW.last_consumer = '', 0, CRC32(NEW.last_consumer));
END$$

DELIMITER ;

-- Trigger Delete
DELIMITER $$

CREATE TRIGGER trg_message_after_delete
AFTER DELETE ON message
FOR EACH ROW
BEGIN
    DELETE FROM message_stat WHERE id = OLD.id;
END$$

DELIMITER ;