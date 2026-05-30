# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy the full source (dockerignore keeps context small)
COPY . .

# Restore + publish the API (which pulls in all project references)
RUN dotnet restore api/BreathApi.csproj
RUN dotnet publish api/BreathApi.csproj -c Release -o /app/publish --no-restore

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# Copy published output from build stage
COPY --from=build /app/publish .

# Create writable runtime directories
RUN mkdir -p /app/wwwroot/output/results \
             /app/wwwroot/output/logs \
             /app/wwwroot/cache && \
    chmod -R 777 /app/wwwroot/output /app/wwwroot/cache

ENV ASPNETCORE_ENVIRONMENT=Production

# Render injects PORT at runtime; expose the default
EXPOSE 8080

ENTRYPOINT ["dotnet", "BreathApi.dll"]
