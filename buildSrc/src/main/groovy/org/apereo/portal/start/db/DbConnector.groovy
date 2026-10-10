package org.apereo.portal.start.db

import java.sql.Connection
import java.sql.Driver
import java.sql.SQLException

/**
 * Opens JDBC connections with a driver loaded from the given jar files, so the Gradle build
 * classpath never has to contain a JDBC driver (DriverManager ignores drivers that are not visible
 * to the caller's class loader, so the driver is instantiated directly).
 */
class DbConnector {

    final String driverClass
    final String url
    final String username
    final String password
    private final Driver driver

    DbConnector(Collection<File> driverJars, String driverClass, String url, String username, String password) {
        this.driverClass = driverClass
        this.url = url
        this.username = username
        this.password = password
        ClassLoader loader = new URLClassLoader(driverJars.collect { it.toURI().toURL() } as URL[], platformClassLoader())
        this.driver = (Driver) Class.forName(driverClass, true, loader).getDeclaredConstructor().newInstance()
    }

    Connection connect() throws SQLException {
        Properties props = new Properties()
        if (username != null) {
            props.setProperty('user', username)
        }
        if (password != null) {
            props.setProperty('password', password)
        }
        Connection connection = driver.connect(url, props)
        if (connection == null) {
            throw new SQLException("Driver ${driverClass} does not accept the URL ${url}")
        }
        return connection
    }

    /**
     * Keeps retrying until the database accepts a connection; container databases (Oracle in
     * particular) can take minutes to finish initializing after their port is open.
     */
    void waitUntilAvailable(int timeoutSeconds, Closure<Void> log) {
        long deadline = System.currentTimeMillis() + timeoutSeconds * 1000L
        SQLException last = null
        int attempts = 0
        while (System.currentTimeMillis() < deadline) {
            attempts++
            try {
                Connection c = connect()
                c.close()
                log("Database is accepting connections at ${url} (after ${attempts} attempt(s))")
                return
            } catch (SQLException e) {
                last = e
                if (attempts == 1 || attempts % 10 == 0) {
                    log("Waiting for ${url}: ${e.message?.readLines()?.first()}")
                }
                Thread.sleep(3000)
            }
        }
        throw new SQLException("Database at ${url} did not accept a connection within ${timeoutSeconds}s", last)
    }

    /**
     * The JDBC driver must see java.sql and friends, which live in the platform class loader on
     * Java 9+ (and in the extension loader on Java 8); never the Gradle classpath.
     */
    static ClassLoader platformClassLoader() {
        return ClassLoader.getSystemClassLoader().getParent()
    }
}
