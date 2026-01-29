class AppException(Exception):
    """Base application exception."""
    pass

class DocumentNotFoundError(AppException):
    """Raised when a document is not found."""
    pass
