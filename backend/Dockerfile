FROM python:3.12-slim

WORKDIR /app

# Install hatchling for building the package
RUN pip install --no-cache-dir hatchling

COPY pyproject.toml .
COPY src ./src

# Install package dependencies
RUN pip install --no-cache-dir .

EXPOSE 8765

ENV RELAY_HOST=0.0.0.0
ENV RELAY_PORT=8765
ENV PYTHONPATH=/app/src

CMD ["python", "-m", "uvicorn", "relay.main:app", "--host", "0.0.0.0", "--port", "8765"]
