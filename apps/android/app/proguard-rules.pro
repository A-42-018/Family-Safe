# R8 runs on release builds (minify + shrinkResources).
# kotlinx.serialization and Ktor ship their own consumer rules. Only warnings for JVM-only classes that Android lacks
# (Ktor's optional SLF4J logging bridge and its IDE debug detector) are silenced here.
-dontwarn org.slf4j.**
-dontwarn java.lang.management.**
