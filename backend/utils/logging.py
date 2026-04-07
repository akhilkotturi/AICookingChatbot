import logging
import sys
import os
from pythonjsonlogger import jsonlogger


class MiseJsonFormatter(jsonlogger.JsonFormatter):
    """
    Custom formatter that produces clean JSON logs.
    Dynatrace and CloudWatch can both parse this format natively.
    """
    def add_fields(self, log_record, record, message_dict):
        super().add_fields(log_record, record, message_dict)
        # Rename fields to match common log schemas
        log_record["level"] = record.levelname
        log_record["logger"] = record.name
        # Remove the redundant default fields
        log_record.pop("levelname", None)
        log_record.pop("name", None)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)

    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)

        if os.getenv("ENV", "development") == "production":
            # Production: JSON for Dynatrace / CloudWatch ingestion
            formatter = MiseJsonFormatter(
                fmt="%(asctime)s %(level)s %(logger)s %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%SZ",
            )
        else:
            # Development: human readable
            formatter = logging.Formatter(
                fmt="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )

        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)
        logger.propagate = False

    return logger


def log_query_event(
    logger: logging.Logger,
    query: str,
    question_type: str | None,
    scope: str | None,
    cookware_in_use: list[str] | None,
    missing_cookware: list[str] | None,
    user_id: str | None,
    latency_ms: float | None = None,
):
    """
    Emit a structured analytics event for every completed query.
    
    In production this gets picked up by Dynatrace log monitoring.
    It can also feed the Kinesis/SQS analytics pipeline described
    in the README.
    
    We log query_length instead of the query itself to avoid
    storing PII in logs.
    """
    logger.info(
        "query_completed",
        extra={
            "event": "query_completed",
            "query_length": len(query),
            "question_type": question_type,
            "scope": scope,
            "cookware_in_use": cookware_in_use or [],
            "missing_cookware": missing_cookware or [],
            "has_user": user_id is not None,
            "latency_ms": latency_ms,
        },
    )