/**
 * Copyright � 2001 The JA-SIG Collaborative.  All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in
 *    the documentation and/or other materials provided with the
 *    distribution.
 *
 * 3. Redistributions of any form whatsoever must retain the following
 *    acknowledgment:
 *    "This product includes software developed by the JA-SIG Collaborative
 *    (http://www.jasig.org/)."
 *
 * THIS SOFTWARE IS PROVIDED BY THE JA-SIG COLLABORATIVE "AS IS" AND ANY
 * EXPRESSED OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE JA-SIG COLLABORATIVE OR
 * ITS CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
 * SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 * NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
 * STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED
 * OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 */


package  org.jasig.portal;

import  org.jasig.portal.security.IPerson;
import  org.w3c.dom.*;
import  javax.servlet.http.*;
import  java.util.*;


/**
 * Interface to user layout management class.
 * @author Peter Kharchenko <a href="mailto:">pkharchenko@interactivebusiness.com</a>
 * @version $Revision$
 */
public interface IUserLayoutManager {

    /* This function processes request parameters related to
     * setting Structure/Theme stylesheet parameters and attributes.
     * (uP_sparam, uP_tparam, uP_sfattr, uP_scattr uP_tcattr)
     * It also processes layout root requests (uP_root)
     * @param req current <code>HttpServletRequest</code>
     */
    public void processUserPreferencesParameters (HttpServletRequest req);

    /**
     * Returns current person object
     * @return current <code>IPerson</code>
     */
    public IPerson getPerson ();

    /**
     * Returns a global channel ID given a channel instance ID
     * @param channelInstanceID instance id of a channel
     * @return channel global id
     */
    public String getChannelGlobalID (String channelInstanceID);

    /**
     * Determine if the user agent associated with this session has been successfuly mapped to a profile
     * @return <code>true</code> if no mapping was found
     */
    public boolean isUserAgentUnmapped();

    /*
     * Resets both user layout and user preferences.
     * Note that if any of the two are "null", old values will be used.
     */
    public void setNewUserLayoutAndUserPreferences (Document newLayout, UserPreferences newPreferences) throws PortalException;


    /**
     * Create and return a copy of the user layout
     * @return a copy of the user layout <code>Document</code>
     */
    public Document getUserLayoutCopy ();
    
    /**
     * Returns a copy of the user preferences
     * @return a copy of the <code>UserPreferences</code> object
     */
    public UserPreferences getUserPreferencesCopy ();

    /**
     * Returns current profile.
     * @return current <code>UserProfile</code>
     */
    public UserProfile getCurrentProfile ();

    /**
     * Returns current theme stylesheet description
     * @return current <code>ThemeStylesheetDescription</code>
     */
    public ThemeStylesheetDescription getThemeStylesheetDescription ();

    /**
     * Returns current structure stylesheet description
     * @return current <code>StructureStylesheetDescription</code>
     */
    public StructureStylesheetDescription getStructureStylesheetDescription ();

    /**
     * Returns a user layout node.
     * @param elementID node's ID value
     * @return <code>Node</code> that matches elementID
     */
    public Node getUserLayoutNode (String elementID);

    /**
     * Returns user layout root node. Careful, this is not a copy!
     * @return user layout <code>Document</code>
     */
    public Document getUserLayout();

    /**
     * Returns current user preferences.
     * @return current <code>UserPreferences</code>
     */
    public UserPreferences getUserPreferences();

    /**
     * helper function that allows to determine the name of a channel or
     *  folder in the current user layout given their ID.
     * @param nodeID id of the node
     * @return node's name value
     */
    public String getNodeName (String nodeID);
    
    /**
     * Removes a channel 
     * @param channelID channel instance ID
     */
    public void removeChannel (String str_ID) throws PortalException;
}



