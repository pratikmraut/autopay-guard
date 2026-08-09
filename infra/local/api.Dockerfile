FROM eclipse-temurin:25-jdk-alpine AS build

WORKDIR /workspace

COPY services/api/.mvn .mvn
COPY services/api/mvnw services/api/mvnw.cmd services/api/pom.xml ./
RUN chmod +x mvnw && ./mvnw --batch-mode --no-transfer-progress dependency:go-offline

COPY services/api/src src
RUN ./mvnw --batch-mode --no-transfer-progress -DskipTests package

FROM eclipse-temurin:25-jre-alpine

RUN apk upgrade --no-cache \
    && addgroup -S app \
    && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /workspace/target/*.jar /app/app.jar

USER app
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-jar", "/app/app.jar"]
