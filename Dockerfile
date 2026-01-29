# Stage 1: Builder
FROM python:3.11-slim as builder

WORKDIR /app

COPY requirements.txt .
# Install dependencies into a specific folder
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Runtime
FROM python:3.11-slim

WORKDIR /app

# Copy only the installed packages from the builder stage
COPY --from=builder /root/.local /root/.local

# Update PATH to include the user's local bin
ENV PATH=/root/.local/bin:$PATH

# Copy application files
COPY app/ ./app/
COPY static/ ./static/

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 8005

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005"]
