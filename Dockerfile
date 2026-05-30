# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy solution + project files first (layer-cache friendly)
COPY breath.sln .
COPY api/BreathApi.csproj          api/
COPY core/runner/runner.csproj     core/runner/
COPY core/source/source.csproj     core/source/
COPY core/optimizer/optimizerSimplex.csproj core/optimizer/

# Restore all NuGet packages
RUN dotnet restore api/BreathApi.csproj

# Copy everything else and publish
COPY . .
RUN dotnet publish api/BreathApi.csproj -c Release -o /app/publish --no-restore

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app

# Create runtime directories (weather cache, output) with correct permissions
RUN mkdir -p /app/wwwroot/output/results \
             /app/wwwroot/output/logs \
             /app/wwwroot/cache \
             /tmp && \
    chmod -R 777 /app/wwwroot/output /app/wwwroot/cache

COPY --from=build /app/publish .

# Render.com injects PORT; 8080 is the conventional default
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080
ENV PORT=8080

ENTRYPOINT ["dotnet", "BreathApi.dll"]
