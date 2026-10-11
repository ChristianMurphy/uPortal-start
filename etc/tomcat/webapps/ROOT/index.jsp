<%-- uPortal-start's ROOT webapp only sends / to the portal (MOD-I251). Tomcat's own ROOT page
     named the Tomcat version.  Change the target if the portal's context path is not /uPortal. --%><%
    response.sendRedirect("/uPortal/");
%>
